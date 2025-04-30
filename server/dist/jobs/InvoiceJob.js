import { prisma } from "../utils/prisma.js";
export class InvoiceJobs {
    /**
     * Updates the status of invoices to "OVERDUE" if their payment date has passed
     * and their current status is "DRAFT".
     *
     * This method retrieves all invoices from the database, checks if their payment
     * date is earlier than the current date, and if their status is "DRAFT". If both
     * conditions are met, the invoice status is updated to "OVERDUE".
     *
     * @async
     * @throws Will throw an error if the database query or update operation fails.
     */
    static async makeInvoiceOverDue() {
        const allInvoice = await prisma.invoice.findMany();
        const invoiceNos = allInvoice.map((invoice) => {
            const isOverdue = invoice.paymentDate < new Date();
            if (isOverdue && invoice.status === "DRAFT") {
                return invoice.invoiceNo;
            }
        });
        invoiceNos.forEach(async (nos) => {
            await prisma.invoice.update({
                where: { invoiceNo: nos },
                data: { status: "OVERDUE" },
            });
        });
    }
}
