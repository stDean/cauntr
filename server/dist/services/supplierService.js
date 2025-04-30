import { prisma } from "../utils/prisma.js";
export const supplierService = {
    getOrCreate: async (name, phone, companyId, tenantId) => {
        return prisma.supplier.upsert({
            where: { name_contact: { name, contact: phone } },
            create: { name, contact: phone, companyId, tenantId },
            update: { name, contact: phone },
        });
    },
    bulkGetOrCreate: async (suppliers) => {
        const uniqueSuppliers = [
            ...new Map(suppliers.map((s) => [`${s.name}|${s.phone}`, s])).values(),
        ];
        const existing = await prisma.supplier.findMany({
            where: {
                OR: uniqueSuppliers.map((s) => ({ name: s.name, contact: s.phone })),
            },
        });
        const newSuppliers = uniqueSuppliers.filter((s) => !existing.some((es) => es.name === s.name && es.contact === s.phone));
        if (newSuppliers.length > 0) {
            await prisma.supplier.createMany({
                data: newSuppliers.map((s) => ({
                    name: s.name,
                    contact: s.phone,
                    companyId: s.companyId,
                    tenantId: s.tenantId,
                })),
                skipDuplicates: true,
            });
        }
        return prisma.supplier.findMany({
            where: {
                OR: uniqueSuppliers.map((s) => ({ name: s.name, contact: s.phone })),
            },
        });
    },
};
