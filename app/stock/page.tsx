import { StockWorkspace } from "@/components/stock-workspace";
import { PageHeader, SetupNotice } from "@/components/ui";
import {
  getCustomers,
  getProductsWithStock,
  getSuppliers,
  getTransactions,
  isSupabaseConfigured,
} from "@/lib/data";


export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;

  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Purchase / Sales" />
        <SetupNotice />
      </>
    );
  }

  const [products, suppliers, customers, transactions] = await Promise.all([
    getProductsWithStock(),
    getSuppliers(),
    getCustomers(),
    getTransactions(),
  ]);

  return (
    <StockWorkspace
      initialProducts={products}
      initialSuppliers={suppliers}
      initialCustomers={customers}
      initialTransactions={transactions}
      initialSuccess={success}
      initialError={error}
    />
  );
}
