"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { UomSelect } from "@/components/uom-select";
import type {
  Customer,
  ProductWithStock,
  Supplier,
  TransactionWithProduct,
} from "@/lib/types";
import {
  formatCurrency,
  formatDateTime,
  formatProductUom,
  normalizeProductUom,
} from "@/lib/utils";
import {
  Badge,
  Card,
  buttonClass,
  inputClass,
  labelClass,
} from "@/components/ui";

type StockMode = "purchase" | "sales";

export function StockWorkspace({
  initialProducts,
  initialSuppliers,
  initialCustomers,
  initialTransactions,
  initialSuccess,
  initialError,
}: {
  initialProducts: ProductWithStock[];
  initialSuppliers: Supplier[];
  initialCustomers?: Customer[];
  initialTransactions: TransactionWithProduct[];
  initialSuccess?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [products, setProducts] = useState(initialProducts);
  const [customers, setCustomers] = useState(initialCustomers ?? []);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [success, setSuccess] = useState(initialSuccess ?? "");
  const [error, setError] = useState(initialError ?? "");
  const [stockInLoading, setStockInLoading] = useState(false);
  const [stockOutLoading, setStockOutLoading] = useState(false);
  const [inProductId, setInProductId] = useState("");
  const [outProductId, setOutProductId] = useState("");
  const [outQty, setOutQty] = useState("");
  const [outPrice, setOutPrice] = useState("");
  const [inUom, setInUom] = useState("pcs");
  const [outUom, setOutUom] = useState("pcs");
  const [mode, setMode] = useState<StockMode>("purchase");
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [inPayment, setInPayment] = useState("cash");
  const [outPayment, setOutPayment] = useState("cash");

  const selectedInProduct =
    products.find((p) => p.id === inProductId) ?? null;
  const selectedOutProduct =
    products.find((p) => p.id === outProductId) ?? null;

  const saleTotal = (Number(outQty) || 0) * (Number(outPrice) || 0);

  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);

  useEffect(() => {
    setCustomers(initialCustomers ?? []);
  }, [initialCustomers]);

  useEffect(() => {
    setTransactions(initialTransactions);
  }, [initialTransactions]);

  async function submitStock(
    action: "in" | "out",
    form: HTMLFormElement,
    setLoading: (v: boolean) => void
  ): Promise<boolean> {
    setError("");
    setLoading(true);
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.action = action;

    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; message?: string };

      if (!res.ok) {
        setError(data.error ?? "Stock operation failed");
        return false;
      }

      setSuccess(data.message ?? "Done");
      const qty = Number(payload.quantity) || 0;
      const productId = String(payload.product_id ?? "");
      if (productId && qty > 0) {
        setProducts((prev) =>
          prev.map((p) =>
            p.id === productId
              ? {
                  ...p,
                  total_stock:
                    action === "in"
                      ? p.total_stock + qty
                      : Math.max(0, p.total_stock - qty),
                }
              : p
          )
        );
      }
      const newName = String(payload.customer_name ?? "").trim();
      if (action === "out" && newName && !String(payload.customer_id ?? "").trim()) {
        setCustomers((prev) => [
          {
            id: `temp-${Date.now()}`,
            full_name: newName,
            phone: String(payload.customer_phone ?? "") || null,
            email: String(payload.customer_email ?? "") || null,
            address: String(payload.customer_address ?? "") || null,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
      form.reset();
      startTransition(() => router.refresh());
      return true;
    } catch (err) {
      setError((err as Error).message || "Stock operation failed");
      return false;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-slate-900">Purchase / Sales</h1>
      <p className="mt-1 text-sm text-slate-500">
        Pick Purchase or Sales, fill in the form, then save.
      </p>

      <div
        className="mt-6 grid grid-cols-2 gap-2"
        role="tablist"
        aria-label="Purchase or sales"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "purchase"}
          onClick={() => setMode("purchase")}
          className={`rounded-lg py-3 text-sm font-semibold transition-colors ${
            mode === "purchase"
              ? "bg-teal-600 text-white shadow-sm"
              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Purchase
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sales"}
          onClick={() => setMode("sales")}
          className={`rounded-lg py-3 text-sm font-semibold transition-colors ${
            mode === "sales"
              ? "bg-teal-600 text-white shadow-sm"
              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Sales
        </button>
      </div>

      {success && (
        <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          {success}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="mt-4">
        {mode === "purchase" ? (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await submitStock(
                "in",
                e.currentTarget,
                setStockInLoading
              );
              if (ok) {
                setInProductId("");
                setInUom("pcs");
                setInPayment("cash");
              }
            }}
          >
            <div>
              <label className={labelClass} htmlFor="in-product">
                Product
              </label>
              <select
                id="in-product"
                name="product_id"
                required
                className={inputClass}
                value={inProductId}
                onChange={(e) => {
                  const id = e.target.value;
                  setInProductId(id);
                  const product = products.find((p) => p.id === id);
                  setInUom(normalizeProductUom(product?.unit) ?? "pcs");
                }}
              >
                <option value="" disabled>
                  Choose a product…
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.product_name} — {p.total_stock} in stock
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="in-batch">
                Brand
              </label>
              <input
                id="in-batch"
                name="batch_number"
                required
                placeholder="e.g. Unilab"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="in-expiry">
                Expiry date
              </label>
              <input
                id="in-expiry"
                name="expiry_date"
                type="date"
                required
                className={inputClass}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="in-qty">
                  Quantity
                </label>
                <input
                  id="in-qty"
                  name="quantity"
                  type="number"
                  min={1}
                  required
                  placeholder="How many?"
                  className={inputClass}
                />
              </div>
              <UomSelect
                id="in-uom"
                required
                value={inUom}
                onChange={setInUom}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="in-cost">
                Cost per unit (&#8369;)
              </label>
              <input
                id="in-cost"
                name="purchase_price"
                type="number"
                step="0.01"
                min={0}
                defaultValue={0}
                className={inputClass}
              />
            </div>
            <details className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-slate-600">
                More options
              </summary>
              <div className="mt-3 space-y-4 pb-1">
                <div>
                  <label className={labelClass} htmlFor="in-supplier">
                    Supplier
                  </label>
                  <select
                    id="in-supplier"
                    name="supplier_id"
                    className={inputClass}
                    defaultValue=""
                  >
                    <option value="">None</option>
                    {initialSuppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.company_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="in-payment">
                    Payment method
                  </label>
                  <select
                    id="in-payment"
                    name="payment_method"
                    className={inputClass}
                    value={inPayment}
                    onChange={(e) => setInPayment(e.target.value)}
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="gcash">GCash</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="in-ref">
                    Reference
                  </label>
                  <input
                    id="in-ref"
                    name="reference_no"
                    placeholder="PO or invoice number"
                    className={inputClass}
                  />
                </div>
              </div>
            </details>
            <button
              type="submit"
              disabled={stockInLoading}
              className={`${buttonClass} w-full`}
            >
              {stockInLoading ? "Saving…" : "Save purchase"}
            </button>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await submitStock(
                "out",
                e.currentTarget,
                setStockOutLoading
              );
              if (ok) {
                setOutProductId("");
                setOutQty("");
                setOutPrice("");
                setOutUom("pcs");
                setOutPayment("cash");
                setCustomerMode("existing");
              }
            }}
          >
            <div>
              <label className={labelClass} htmlFor="out-product">
                Product
              </label>
              <select
                id="out-product"
                name="product_id"
                required
                className={inputClass}
                value={outProductId}
                onChange={(e) => {
                  const id = e.target.value;
                  setOutProductId(id);
                  const product = products.find((p) => p.id === id);
                  setOutUom(normalizeProductUom(product?.unit) ?? "pcs");
                  setOutPrice(
                    product ? String(product.selling_price ?? "") : ""
                  );
                }}
              >
                <option value="" disabled>
                  Choose a product…
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.product_name} — {p.total_stock} in stock
                  </option>
                ))}
              </select>
              {selectedOutProduct && (
                <p
                  className={`mt-1.5 text-sm ${
                    selectedOutProduct.total_stock > 0
                      ? "text-slate-500"
                      : "text-red-600"
                  }`}
                >
                  {selectedOutProduct.total_stock > 0
                    ? `${selectedOutProduct.total_stock} available`
                    : "Out of stock"}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="out-qty">
                  Quantity
                </label>
                <input
                  id="out-qty"
                  name="quantity"
                  type="number"
                  min={1}
                  max={selectedOutProduct?.total_stock || undefined}
                  required
                  value={outQty}
                  onChange={(e) => setOutQty(e.target.value)}
                  placeholder="How many?"
                  className={inputClass}
                />
              </div>
              <UomSelect
                id="out-uom"
                required
                value={outUom}
                onChange={setOutUom}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="out-price">
                Price per unit (&#8369;)
              </label>
              <input
                id="out-price"
                name="unit_price"
                type="number"
                step="0.01"
                min={0}
                value={outPrice}
                onChange={(e) => setOutPrice(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            {saleTotal > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-teal-100 bg-teal-50 px-4 py-3">
                <span className="text-sm font-medium text-slate-700">Total</span>
                <span className="text-xl font-semibold text-teal-700">
                  {formatCurrency(saleTotal)}
                </span>
              </div>
            )}
            <div>
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setCustomerMode("existing")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    customerMode === "existing"
                      ? "bg-teal-600 text-white"
                      : "border border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  Existing customer
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerMode("new")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    customerMode === "new"
                      ? "bg-teal-600 text-white"
                      : "border border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  New customer
                </button>
              </div>
              {customerMode === "existing" ? (
                <div>
                  <label className={labelClass} htmlFor="out-customer">
                    Customer
                  </label>
                  <select
                    id="out-customer"
                    name="customer_id"
                    className={inputClass}
                    defaultValue=""
                  >
                    <option value="">Walk-in (no customer)</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name ?? "Unnamed"}
                        {c.phone ? ` — ${c.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className={labelClass} htmlFor="out-customer-name">
                      Customer name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="out-customer-name"
                      name="customer_name"
                      required
                      placeholder="Full name"
                      className={inputClass}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelClass} htmlFor="out-customer-phone">
                        Phone
                      </label>
                      <input
                        id="out-customer-phone"
                        name="customer_phone"
                        placeholder="09xx…"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="out-customer-email">
                        Email
                      </label>
                      <input
                        id="out-customer-email"
                        name="customer_email"
                        type="email"
                        placeholder="optional"
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="out-customer-address">
                      Address
                    </label>
                    <input
                      id="out-customer-address"
                      name="customer_address"
                      placeholder="optional"
                      className={inputClass}
                    />
                  </div>
                  <p className="text-xs text-slate-400">
                    New customers are added to the Customer list when you save
                    the sale.
                  </p>
                </div>
              )}
            </div>
            <details className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-slate-600">
                More options
              </summary>
              <div className="mt-3 space-y-4 pb-1">
                <div>
                  <label className={labelClass} htmlFor="out-payment">
                    Payment method
                  </label>
                  <select
                    id="out-payment"
                    name="payment_method"
                    className={inputClass}
                    value={outPayment}
                    onChange={(e) => setOutPayment(e.target.value)}
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="gcash">GCash</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="out-ref">
                    Reference
                  </label>
                  <input
                    id="out-ref"
                    name="reference_no"
                    placeholder="Invoice or Rx number"
                    className={inputClass}
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Price 0 = remove stock only (damaged/expired).
                </p>
              </div>
            </details>
            <button
              type="submit"
              disabled={
                stockOutLoading ||
                (selectedOutProduct?.total_stock ?? 0) === 0
              }
              className={`${buttonClass} w-full`}
            >
              {stockOutLoading ? "Saving…" : "Save sale"}
            </button>
          </form>
        )}
      </Card>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-800">Recent activity</h2>
        {transactions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {transactions.slice(0, 12).map((t) => {
              const isIn = t.transaction_type.toLowerCase().includes("in");
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">
                      {t.products?.product_name ?? "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t.created_at ? formatDateTime(t.created_at) : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={isIn ? "success" : "info"}>
                      {isIn ? "Purchase" : "Sale"}
                    </Badge>
                    <span className="tabular-nums font-medium text-slate-700">
                      {isIn ? "+" : "−"}
                      {t.quantity}
                      {t.products?.unit
                        ? ` ${formatProductUom(t.products.unit)}`
                        : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
