import { NextResponse } from "next/server";
import { insertCustomer } from "@/lib/customers-db";
import { hasServiceRoleKey } from "@/lib/env";
import { deductStockFifo, generateInvoiceNumber, receiveStockForPo } from "@/lib/pos";
import { issueReceiptForSale } from "@/lib/receipt";
import { revalidateInventory } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveUser } from "@/lib/user-session";
import { normalizeProductUom } from "@/lib/utils";

const PAYMENT_METHODS = new Set(["cash", "card", "gcash"]);

function parsePaymentMethod(value: unknown): string {
  const raw = String(value ?? "cash").trim().toLowerCase();
  return PAYMENT_METHODS.has(raw) ? raw : "cash";
}

async function resolveCustomerId(
  supabase: ReturnType<typeof createAdminClient>,
  body: Record<string, unknown>
): Promise<string | null> {
  const existing = String(body.customer_id ?? "").trim();
  if (existing) return existing;

  const name = String(
    body.customer_name ?? body.new_customer_name ?? ""
  ).trim();
  if (!name) return null;

  const { id, error } = await insertCustomer(supabase, {
    full_name: name,
    phone: String(body.customer_phone ?? "").trim() || null,
    email: String(body.customer_email ?? "").trim() || null,
    address: String(body.customer_address ?? "").trim() || null,
  });
  if (error) throw new Error(error);
  return id;
}

async function syncProductUnit(
  supabase: ReturnType<typeof createAdminClient>,
  productId: string,
  unit: unknown
) {
  const normalized = normalizeProductUom(unit);
  if (!normalized) return;
  await supabase.from("products").update({ unit: normalized }).eq("id", productId);
}

export async function POST(request: Request) {
  const user = await getActiveUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  if (!hasServiceRoleKey()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is missing on the server." },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const supabase = createAdminClient();

    if (action === "in") {
      const productId = String(body.product_id ?? "");
      const quantity = Number(body.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
        return NextResponse.json(
          { error: "Enter a valid product and quantity" },
          { status: 400 }
        );
      }

      try {
        await receiveStockForPo(
          supabase,
          productId,
          quantity,
          String(body.reference_no ?? "").trim() || "purchase",
          {
            unitCost: Number(body.purchase_price ?? 0),
            supplierId: String(body.supplier_id ?? "").trim() || null,
            batchNumber: String(body.batch_number ?? "").trim() || null,
            expiryDate: String(body.expiry_date ?? "").trim() || null,
          }
        );
      } catch (e) {
        return NextResponse.json(
          { error: (e as Error).message },
          { status: 400 }
        );
      }

      await syncProductUnit(supabase, productId, body.unit);

      revalidateInventory("stock", "products");
      return NextResponse.json({ ok: true, message: "Stock received" });
    }

    if (action === "out") {
      const productId = String(body.product_id ?? "");
      const requested = Number(body.quantity);
      const unitPrice = Number(body.unit_price ?? 0);

      if (!productId || !Number.isInteger(requested) || requested <= 0) {
        return NextResponse.json(
          { error: "Enter a valid product and quantity" },
          { status: 400 }
        );
      }

      // With a price this is a sale: create the sale record, deduct FIFO,
      // and log sale items so it appears in sales reports and receipts.
      if (unitPrice > 0) {
        const invoiceNumber = generateInvoiceNumber();
        const referenceNo =
          String(body.reference_no ?? "").trim() || invoiceNumber;
        const total = unitPrice * requested;

        const paymentMethod = parsePaymentMethod(body.payment_method);
        let customerId: string | null = null;
        try {
          customerId = await resolveCustomerId(supabase, body);
        } catch (e) {
          return NextResponse.json(
            { error: (e as Error).message },
            { status: 400 }
          );
        }

        const salePayload: Record<string, string | number | null> = {
          invoice_number: invoiceNumber,
          total_amount: total,
          payment_method: paymentMethod,
        };
        if (customerId) salePayload.customer_id = customerId;

        let { data: sale, error: saleError } = await supabase
          .from("sales")
          .insert(salePayload)
          .select("id")
          .single();

        if (saleError && customerId && saleError.message.includes("customer_id")) {
          delete salePayload.customer_id;
          ({ data: sale, error: saleError } = await supabase
            .from("sales")
            .insert(salePayload)
            .select("id")
            .single());
        }

        if (saleError || !sale) {
          return NextResponse.json(
            { error: saleError?.message ?? "Could not record sale" },
            { status: 400 }
          );
        }

        let allocations;
        try {
          allocations = await deductStockFifo(
            supabase,
            productId,
            requested,
            referenceNo
          );
        } catch (e) {
          await supabase.from("sales").delete().eq("id", sale.id);
          return NextResponse.json(
            { error: (e as Error).message },
            { status: 400 }
          );
        }

        const itemRows = allocations.map((alloc) => ({
          sale_id: sale.id,
          product_id: productId,
          batch_id: alloc.batch_id,
          quantity: alloc.quantity,
          unit_price: unitPrice,
          subtotal: alloc.quantity * unitPrice,
        }));

        let { error: itemError } = await supabase
          .from("sale_items")
          .insert(itemRows);
        // Flat-register schemas have no real batches: batch_id points at the
        // product, which violates the sale_items FK — retry without it.
        if (itemError && itemError.message.includes("batch_id")) {
          ({ error: itemError } = await supabase
            .from("sale_items")
            .insert(itemRows.map((row) => ({ ...row, batch_id: null }))));
        }
        if (itemError) {
          await supabase.from("sales").delete().eq("id", sale.id);
          return NextResponse.json(
            { error: itemError.message },
            { status: 400 }
          );
        }

        let receiptNote = "";
        try {
          const receipt = await issueReceiptForSale(supabase, sale.id);
          receiptNote = ` — receipt ${receipt.receiptNumber}`;
        } catch {
          // Receipt issuing is best-effort; the sale itself is recorded.
        }

        await syncProductUnit(supabase, productId, body.unit);

        revalidateInventory("stock", "products", "customers", "sales");
        return NextResponse.json({
          ok: true,
          sale_id: sale.id,
          invoice_number: invoiceNumber,
          message: `Sale recorded (${invoiceNumber})${receiptNote}`,
        });
      }

      const referenceNo =
        String(body.reference_no ?? "").trim() || "stock-out";
      try {
        await deductStockFifo(supabase, productId, requested, referenceNo);
      } catch (e) {
        return NextResponse.json(
          { error: (e as Error).message },
          { status: 400 }
        );
      }

      await syncProductUnit(supabase, productId, body.unit);

      revalidateInventory("stock", "products");
      return NextResponse.json({ ok: true, message: "Stock dispensed (FIFO)" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "Stock operation failed" },
      { status: 500 }
    );
  }
}
