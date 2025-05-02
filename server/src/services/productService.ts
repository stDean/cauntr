import { Condition, Supplier } from "@prisma/client";
import { generateSKU } from "../utils/helper.js";
import { ProductInput, productUtils } from "../utils/helperUtils.js";
import { prisma } from "../utils/prisma.js";

export const productService = {
  findProductBySerial: async (serialNo: string, companyId: string) => {
    return prisma.product.findUnique({
      where: { serialNo: serialNo, companyId: companyId },
    });
  },

  updateProductQuantity: async (productId: string, quantityChange: number) => {
    return prisma.product.update({
      where: { id: productId },
      data: { quantity: { increment: quantityChange } },
    });
  },

  createProductData: (
    input: ProductInput,
    user: { id: string },
    company: { id: string; tenantId: string },
    supplier?: Supplier
  ) => ({
    tenantId: company.tenantId,
    sku: input.sku || generateSKU(input.productType)!,
    productName: input.productName,
    description: input.description || null,
    brand: input.brand,
    productType: input.productType,
    costPrice: Number(input.costPrice || 0),
    sellingPrice: Number(input.sellingPrice) || 0,
    serialNo: input.serialNo || null,
    purchaseDate: input.purchaseDate
      ? new Date(input.purchaseDate)
      : new Date(),
    condition: input.condition
      ? productUtils.normalizeCondition(input.condition)
      : Condition.NEW,
    quantity: Number(input.quantity || 1),
    createdById: user.id,
    supplierId: supplier ? supplier.id : null,
    companyId: company.id,
  }),
};
