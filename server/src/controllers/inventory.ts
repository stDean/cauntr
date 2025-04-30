import { Condition, Product, Supplier } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  BadRequestError,
  NotFoundError,
  UnauthenticatedError,
} from "../errors";
import { productService } from "../services/productService";
import { supplierService } from "../services/supplierService";
import {
  generateSKU,
  handleBuybackProduct,
  parseDate,
  productHelper,
  userNdCompany,
} from "../utils/helper";
import {
  ProductInput,
  productUtils,
  responseUtils,
} from "../utils/helperUtils";
import { prisma } from "../utils/prisma";
import { generateSalesReport, getSoldOrSwapProducts } from "./transaction";

export const InventoryCtrl = {
  /**
   * Create a single product (or handle a buy-back scenario).
   *
   * Steps:
   * 1. Retrieve the current user and company info based on the authenticated request.
   * 2. Validate the incoming product input.
   * 3. Retrieve or create the supplier based on the supplier name and phone.
   * 4. Normalize the product condition (defaulting to NEW if not provided or invalid).
   * 5. Check if a product with the provided serial number already exists:
   *    - If an existing product is found:
   *       a. Upsert a customer record using the supplier's details.
   *       b. If the existing product has a quantity greater than zero, update its quantity by adding the new quantity and create a buy-back transaction.
   *       c. Otherwise, update the product’s details and create a buy-back transaction.
   *    - If no existing product is found, create a new product record.
   * 6. Return a CREATED response with the created product or the buy-back transaction details.
   */
  createProduct: async (req: Request, res: Response) => {
    const productInput = req.body as ProductInput;
    const { user, company } = await userNdCompany(req.user);
    const errors = productUtils.validateProduct(productInput);

    if (errors) {
      return responseUtils.error(
        res,
        "Validation failed",
        StatusCodes.BAD_REQUEST,
        errors
      );
    }

    // Retrieve or create the supplier using the supplier's name and phone number.
    let supplier;
    if (productInput.supplierName || productInput.supplierPhone) {
      supplier = await supplierService.getOrCreate(
        productInput.supplierName,
        productInput.supplierPhone,
        company.id,
        company.tenantId
      );
    }

    if (productInput.serialNo) {
      const existingProduct = await productService.findProductBySerial(
        productInput.serialNo,
        company.id
      );

      if (existingProduct) {
        return handleBuybackProduct({
          res,
          existingProduct,
          productInput,
          user,
          company,
          supplier,
        });
      }
    }

    // Create the product record using the validated and normalized data.
    const productData = productService.createProductData(
      productInput,
      user,
      company,
      supplier
    );
    const createdProduct = await prisma.product.create({ data: productData });
    responseUtils.success(res, createdProduct, StatusCodes.CREATED);
  },

  /**
   * Create multiple products (bulk creation).
   * - Expects the request body to be an array of product objects.
   * - Validates each product for required fields.
   * - Processes supplier details in bulk.
   * - Creates new suppliers if needed.
   * - Processes each product creation concurrently and handles errors individually.
   */
  createProducts: async (req: Request, res: Response) => {
    // Ensure that the request body is an array.
    if (!Array.isArray(req.body)) {
      throw new BadRequestError("Request body must be an array of products");
    }

    // Retrieve the current user and company information.
    const { user, company } = await userNdCompany(req.user);

    // Filter products that include BOTH supplier details.
    const productsWithSupplier = req.body.filter(
      (p) => p["Supplier Name"] && String(p["Supplier Phone Number"])
    );

    // If any products include supplier details, perform a bulk getOrCreate.
    const suppliers =
      productsWithSupplier.length > 0
        ? await supplierService.bulkGetOrCreate(
            productsWithSupplier.map((p) => ({
              name: p["Supplier Name"],
              phone: String(p["Supplier Phone Number"]),
              companyId: company.id,
              tenantId: company.tenantId,
            }))
          )
        : [];

    const results: any = [];
    const errors: any = [];

    await Promise.all(
      req.body.map(async (product, index) => {
        try {
          const supplier = suppliers.find(
            (s) =>
              s.name === product["Supplier Name"] &&
              s.contact === String(product["Supplier Phone Number"])
          );

          // if (!supplier) throw new BadRequestError("Supplier not found");

          const dataInput: any = {
            tenantId: company.tenantId,
            sku: product["SKU"] || generateSKU(product["Item Type"]),
            productName: product["Product Name"],
            description: product["Description"] || null,
            brand: product["Brand"],
            productType: product["Item Type"],
            costPrice: Number(product["Cost Price"]) || 0,
            sellingPrice: Number(product["Selling Price"]) || 0,
            serialNo: product["Serial Number"],
            purchaseDate: parseDate(product["Purchase Date"]) || new Date(),
            condition: product["Condition"]
              ? (product["Condition"].toUpperCase() as Condition)
              : Condition.NEW,
            quantity: Number(product["Quantity"]) || 1,
            createdById: user.id,
            supplierId: supplier && supplier.id,
            companyId: company.id,
          };

          const productData = productService.createProductData(
            dataInput,
            user,
            company,
            supplier
          );
          results.push(await prisma.product.create({ data: productData }));
        } catch (error: any) {
          errors.push({
            product: product?.["Serial Number"] || "Unknown",
            error: `Error creating product with serial number ${product?.["Serial Number"]}`,
          });
        }
      })
    );

    errors.length > 0
      ? responseUtils.multiStatus(res, results, errors)
      : responseUtils.success(res, results, StatusCodes.CREATED);
  },

  /**
   * Get product counts grouped by product type and brand.
   * - Groups products based on type and brand.
   * - Returns the count (number of products) and the sum of quantities in each group.
   */
  getProductCountsByTypeAndBrand: async (req: Request, res: Response) => {
    const { email, companyId } = req.user;
    const { company } = await userNdCompany({ email, companyId });

    // Group products by productType and brand,
    // count the occurrences and sum the quantity for each group.
    const groupedProducts = await prisma.product.groupBy({
      where: {
        companyId: company.id,
        tenantId: company.tenantId,
        quantity: { gt: 0 },
      },
      by: ["productType", "brand", "productName"],
      _count: { _all: true },
      _sum: { quantity: true, sellingPrice: true },
    });

    const result = groupedProducts
      .filter((p) => p._sum.quantity !== 0)
      .map((group) => {
        // Compute an average selling price for the group.
        const count = group._count._all;
        const totalSellingPrice = group._sum.sellingPrice || 0;
        const avgSellingPrice = count ? Number(totalSellingPrice) / count : 0;
        // Calculate inventory value as total quantity * average selling price.
        const inventoryValue = (group._sum.quantity || 0) * avgSellingPrice;

        return {
          // categories: group._count._all,
          productName: group.productName,
          stockCount: group._sum.quantity,
          productType: group.productType,
          brand: group.brand,
          inventoryValue, // Total inventory value for this group
        };
      });

    res.status(StatusCodes.OK).json({
      success: true,
      data: result,
    });
  },

  /**
   * Retrieve products filtered by a given product type and brand.
   */
  getProductsByTypeAndBrand: async (req: Request, res: Response) => {
    const { type, brand, name } = req.params;
    const { email, companyId } = req.user;
    const { company } = await userNdCompany({ email, companyId });

    console.log({ ...req.params });

    // Fetch products matching the specified type and brand.
    const products = await prisma.product.findMany({
      where: {
        companyId: company.id,
        tenantId: company.tenantId,
        productType: type,
        brand,
        productName: name,
      },
    });

    if (products.length === 0) {
      throw new NotFoundError("No products found");
    }

    const allProduct = products.filter((p) => p.quantity !== 0);
    const returnedData = allProduct.map((p) => ({
      productName: p.productName,
      brand: p.brand,
      type: p.productType,
      quantity: p.quantity,
      sellingPrice: p.sellingPrice,
      sku: p.sku,
      serialNo: p.serialNo,
    }));

    res.status(StatusCodes.OK).json({
      success: true,
      data: returnedData,
    });
  },

  /**
   * Retrieve a single product by SKU.
   */
  getProductBySKU: async (req: Request, res: Response) => {
    const {
      params: { sku },
      user: { email, companyId },
    } = req;
    // Use helper to retrieve product data.
    const { product } = await productHelper({ sku, email, companyId });

    res.status(StatusCodes.OK).json({
      success: true,
      data: product,
    });
  },

  /**
   * Update a product identified by its SKU.
   * - Only allowed fields can be updated.
   * - The 'condition' field is normalized to uppercase.
   */
  updateProduct: async (req: Request, res: Response) => {
    const {
      body,
      params: { sku },
      user: { email, companyId },
    } = req;
    const { company } = await productHelper({ sku, email, companyId });

    // Define which fields are allowed to be updated.
    const allowedFields = [
      "description",
      "brand",
      "productType",
      "productName",
      "sellingPrice",
      "costPrice",
      "sku",
      "condition",
      "quantity",
      "purchaseDate",
    ];

    const updateData: Partial<Product> = {};
    // Filter and assign allowed fields from the request body.
    Object.keys(body).forEach((key) => {
      if (allowedFields.includes(key)) {
        updateData[key as keyof Product] = body[key];
      }
    });

    // Normalize and validate the 'condition' field.
    if (updateData.condition) {
      updateData.condition = updateData.condition.toUpperCase() as Condition;
      if (!Object.values(Condition).includes(updateData.condition)) {
        updateData.condition = Condition.NEW;
      }
    }

    // Update the product record in the database.
    const updatedProduct = await prisma.product.update({
      where: {
        sku_companyId_tenantId: {
          sku,
          companyId: company.id,
          tenantId: company.tenantId,
        },
      },
      data: updateData,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      data: updatedProduct,
      mag: "Product updated successfully",
    });
  },

  /**
   * Soft delete a product by reducing its active quantity and logging the deletion event.
   * - Validates the deletion quantity.
   * - Updates the product's quantity.
   * - Creates a deletion event record.
   */
  softDeleteProduct: async (req: Request, res: Response) => {
    const {
      params: { sku },
      user: { email, companyId },
      body: { deleteQuantity },
    } = req;
    const quantityToDelete = Number(deleteQuantity);
    // Validate that a valid deletion quantity is provided.
    if (!quantityToDelete || quantityToDelete <= 0) {
      throw new BadRequestError("Invalid delete quantity provided.");
    }

    // Retrieve the company and product details.
    const { company, product } = await productHelper({ sku, email, companyId });

    // Ensure that the deletion quantity does not exceed the available product quantity.
    if (quantityToDelete > product.quantity!) {
      throw new BadRequestError(
        "Delete quantity exceeds available product quantity.."
      );
    }

    // Perform the update and deletion event creation within a transaction.
    const updatedProduct = await prisma.$transaction(async (tx) => {
      // Update the product's active quantity.
      const productUpdate = await tx.product.update({
        where: {
          sku_companyId_tenantId: {
            sku,
            companyId: company.id,
            tenantId: company.tenantId,
          },
        },
        data: {
          quantity: product.quantity - quantityToDelete,
        },
      });

      // Log the deletion event with the current timestamp and deletion quantity.
      await tx.productDeletionEvent.create({
        data: {
          productId: product.id,
          deletionDate: new Date(),
          quantity: quantityToDelete,
        },
      });

      return productUpdate;
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Product deleted successfully",
      data: updatedProduct,
    });
  },

  /**
   * Retrieve soft-deleted products using deletion event logs.
   * - Fetches products that have at least one deletion event.
   * - Calculates the total deleted quantity and last deletion date per product.
   */
  getSoftDeletedProductsUsingEvents: async (req: Request, res: Response) => {
    const { email, companyId } = req.user;
    const { company } = await userNdCompany({ email, companyId });

    // Fetch products with at least one deletion event.
    const products = await prisma.product.findMany({
      where: {
        companyId: company.id,
        tenantId: company.tenantId,
        ProductDeletionEvent: { some: {} },
      },
      select: {
        sku: true,
        productName: true,
        quantity: true, // Active quantity remaining.
        ProductDeletionEvent: {
          select: {
            deletionDate: true,
            quantity: true,
          },
          orderBy: {
            deletionDate: "asc", // Order events by deletion date.
          },
        },
      },
    });

    if (!products.length) {
      throw new NotFoundError("No products found");
    }

    // For each product, compute the total deleted quantity and the most recent deletion date.
    const softDeletedProducts = products
      .map((product) => {
        const totalDeleted = product.ProductDeletionEvent.reduce(
          (sum, event) => sum + event.quantity,
          0
        );
        if (totalDeleted > 0) {
          const lastDeletionDate = product.ProductDeletionEvent.reduce(
            (latest, event) => {
              return event.deletionDate > latest ? event.deletionDate : latest;
            },
            new Date(0)
          );

          return {
            sku: product.sku,
            productName: product.productName,
            activeQuantity: product.quantity,
            deletedQuantity: totalDeleted,
            lastDeletionDate,
          };
        }
        return null;
      })
      .filter((p) => p !== null);

    res.status(StatusCodes.OK).json({
      success: true,
      data: { products, softDeletedProducts },
    });
  },

  /**
   * Restore a specific quantity of a soft-deleted product.
   * - Validates the restore quantity.
   * - Retrieves all deletion events for the product.
   * - In a transaction, increases the product's active quantity and adjusts/deletes deletion events accordingly.
   */
  restoreProductQuantity: async (req: Request, res: Response) => {
    const {
      params: { sku },
      user: { email, companyId },
      body: { restoreQuantity },
    } = req;
    const quantityToRestore = Number(restoreQuantity);

    // Validate that the restore quantity is valid.
    if (!quantityToRestore || quantityToRestore <= 0) {
      throw new BadRequestError("Invalid restore quantity provided.");
    }

    // Retrieve the company and product information.
    const { company, product } = await productHelper({ sku, email, companyId });

    // Get all deletion events for the product, ordered by deletion date.
    const deletionEvents = await prisma.productDeletionEvent.findMany({
      where: { productId: product.id },
      orderBy: { deletionDate: "asc" },
    });

    // Calculate the total quantity that has been soft-deleted.
    const totalDeleted = deletionEvents.reduce(
      (sum, event) => sum + event.quantity,
      0
    );

    // Ensure that the restore quantity does not exceed the total deleted quantity.
    if (quantityToRestore > totalDeleted) {
      throw new BadRequestError(
        "Restore quantity exceeds deleted product quantity."
      );
    }

    // Use a transaction to update the product's quantity and adjust deletion events.
    const updatedProduct = await prisma.$transaction(async (tx) => {
      // Increase the active quantity of the product.
      const productUpdate = await tx.product.update({
        where: {
          sku_companyId_tenantId: {
            sku,
            companyId: company.id,
            tenantId: company.tenantId,
          },
        },
        data: {
          quantity: product.quantity + quantityToRestore,
        },
      });

      // Process each deletion event until the restore quantity is fulfilled.
      let remainingToRestore = quantityToRestore;
      for (const event of deletionEvents) {
        if (remainingToRestore <= 0) break;

        if (event.quantity > remainingToRestore) {
          // If the event has more quantity than needed, subtract the restore quantity.
          const newQuantity = event.quantity - remainingToRestore;
          if (newQuantity === 0) {
            // If the resulting quantity is zero, delete the event.
            await tx.productDeletionEvent.delete({
              where: { id: event.id },
            });
          } else {
            await tx.productDeletionEvent.update({
              where: { id: event.id },
              data: { quantity: newQuantity },
            });
          }
          remainingToRestore = 0;
        } else {
          // Otherwise, delete the event and reduce the remaining restore quantity.
          await tx.productDeletionEvent.delete({
            where: { id: event.id },
          });
          remainingToRestore -= event.quantity;
        }
      }

      return productUpdate;
    });

    res.status(StatusCodes.OK).json({
      success: true,
      data: updatedProduct,
    });
  },

  /**
   * Hard delete a product's deletion events or the entire product.
   * - If the product still has active quantity (> 0), only deletion events are removed.
   * - If the product's active quantity is zero, the product and its deletion events are deleted.
   */
  hardDeleteProduct: async (req: Request, res: Response) => {
    const {
      params: { sku },
      user: { email, companyId },
    } = req;
    // Retrieve product and company info via helper.
    const { product, company } = await productHelper({ sku, email, companyId });

    if (product.quantity > 0) {
      // Product has active units, so just remove the deletion events.
      await prisma.productDeletionEvent.deleteMany({
        where: { productId: product.id },
      });

      res.status(StatusCodes.OK).json({
        success: true,
        message:
          "Deletion events removed. Product remains with active quantity.",
      });
      return;
    } else {
      // If no active quantity remains, delete the product and its deletion events atomically.
      await prisma.$transaction(async (tx) => {
        await tx.productDeletionEvent.deleteMany({
          where: { productId: product.id },
        });
        await tx.product.delete({
          where: {
            sku_companyId_tenantId: {
              sku,
              companyId: company.id,
              tenantId: company.tenantId,
            },
          },
        });
      });

      res.status(StatusCodes.OK).json({
        success: true,
        message: "Product deleted as no active quantity remains.",
      });
    }
  },

  /**
   * Bulk hard delete soft-deleted products based on provided SKUs.
   * - Expects a request body with an array of SKUs.
   * - For each product:
   *   - If active quantity > 0, only deletion events are removed.
   *   - If active quantity === 0, the product and its deletion events are deleted.
   */
  bulkHardDeleteSoftDeletedProducts: async (req: Request, res: Response) => {
    const { companyId, tenantId } = req.user;
    const { skus } = req.body; // e.g., { skus: ["SKU1", "SKU2", ...] }

    if (!skus || !Array.isArray(skus) || skus.length === 0) {
      throw new BadRequestError("Please provide an array of SKUs to process.");
    }

    // Fetch products with deletion events that match the provided SKUs.
    const products = await prisma.product.findMany({
      where: {
        sku: { in: skus },
        companyId,
        tenantId,
        ProductDeletionEvent: { some: {} },
      },
      select: { id: true, sku: true, quantity: true },
    });

    if (products.length === 0) {
      throw new NotFoundError(
        "No soft-deleted products found for the provided SKUs."
      );
    }

    // Process each product accordingly.
    for (const product of products) {
      if (product.quantity > 0) {
        // Active stock exists – remove deletion events only.
        await prisma.productDeletionEvent.deleteMany({
          where: { productId: product.id },
        });
      } else {
        // No active stock – delete both deletion events and the product.
        await prisma.$transaction(async (tx) => {
          await tx.productDeletionEvent.deleteMany({
            where: { productId: product.id },
          });
          await tx.product.delete({
            where: { id: product.id },
          });
        });
      }
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message:
        "Bulk hard deletion of soft-deleted products processed successfully.",
    });
  },

  /**
   * Get an inventory summary.
   * - Calculates the total stock quantity (sum of all product quantities).
   * - Calculates the total selling price (sum of quantity * sellingPrice).
   * - Counts the number of unique product categories (grouped by productType).
   */
  getInventorySummary: async (req: Request, res: Response) => {
    const { email, companyId } = req.user;
    const { company } = await userNdCompany({ email, companyId });

    const { transactions } = await getSoldOrSwapProducts({
      company,
      inArray: ["SALE", "BULK_SALE"],
    });

    const transactionSummary = generateSalesReport(transactions);

    // Aggregate to get the total stock quantity.
    const totalStockResult = await prisma.product.aggregate({
      where: { companyId: company.id, tenantId: company.tenantId },
      _sum: { quantity: true },
    });

    // Retrieve products to calculate the total selling price.
    const products = await prisma.product.findMany({
      where: { companyId: company.id, tenantId: company.tenantId },
      select: { quantity: true, sellingPrice: true },
    });

    // Calculate the total selling price in-memory.
    const totalSellingPrice = products.reduce(
      (sum, product) => sum + product.quantity * Number(product.sellingPrice),
      0
    );

    // Group products by productType to count distinct categories.
    const groupedCategories = await prisma.product.groupBy({
      by: ["productType"],
      where: { companyId: company.id, tenantId: company.tenantId },
    });

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        totalStockQuantity: totalStockResult._sum.quantity || 0,
        totalSellingPrice,
        categories: groupedCategories.length,
        topSellingProduct: transactionSummary.topSellingProduct,
      },
    });
  },

  getAllProducts: async (req: Request, res: Response): Promise<void> => {
    const { email, companyId } = req.user;
    const { company } = await userNdCompany({ email, companyId });

    const products = await prisma.product.findMany({
      where: { companyId: company.id, tenantId: company.tenantId },
    });

    const returnedProduct = products.map((p) => ({
      productName: p.productName,
      id: p.id,
      qty: p.quantity,
      price: p.sellingPrice,
      brand: p.brand,
      productType: p.productType,
      sn: p.serialNo,
      costPrice: p.costPrice,
      sku: p.sku,
    }));

    res.status(StatusCodes.OK).json({
      msg: "successful",
      data: returnedProduct,
      nbHits: products.length,
    });
  },

  getCategories: async (req: Request, res: Response) => {
    const { email, companyId } = req.user;
    const { company } = await userNdCompany({ email, companyId });

    const products = await prisma.product.findMany({
      where: {
        companyId: company.id,
        tenantId: company.tenantId,
        quantity: { not: 0 },
      },
      select: {
        brand: true,
        productType: true,
      },
    });

    // Group brands by product type with unique values
    const groupedData = products.reduce(
      (acc: { [key: string]: string[] }, product) => {
        const { productType, brand } = product;
        if (!acc[productType]) {
          acc[productType] = [];
        }
        // Add brand if it's not already in the array
        if (!acc[productType].includes(brand)) {
          acc[productType].push(brand);
        }
        return acc;
      },
      {}
    );

    // Convert to array format
    const result = Object.entries(groupedData).map(([productType, brands]) => ({
      productType,
      brands,
    }));

    res.status(StatusCodes.OK).json({
      msg: "Categories successfully obtained",
      data: result,
    });
  },

  getAllBanks: async (req: Request, res: Response) => {
    const { email, companyId } = req.user;
    const { company } = await userNdCompany({ email, companyId });

    const banks = await prisma.companyAccount.findUnique({
      where: { companyId: company.id, tenantId: company.tenantId },
      select: {
        banks: {
          select: {
            acctName: true,
            acctNo: true,
            bankName: true,
            id: true,
          },
        },
      },
    });

    res.status(StatusCodes.OK).json({ msg: "Banks Obtained", data: banks });
  },

  createAllBanks: async (req: Request, res: Response) => {
    const { email, companyId } = req.user;
    const { company } = await userNdCompany({ email, companyId });
    const { bankName, acctNo, acctName } = req.body;

    if (!companyId)
      throw new UnauthenticatedError("Not authorized to perform this action");

    const bank = await prisma.userBank.findFirst({
      where: {
        bankName,
        acctName,
        acctNo,
        companyAccountId: company.CompanyAccount?.id,
      },
    });

    if (bank) throw new BadRequestError("This bank already exist.");

    await prisma.userBank.create({
      data: {
        bankName,
        acctName,
        acctNo,
        companyAccountId: company.CompanyAccount?.id,
      },
    });

    res.status(StatusCodes.CREATED).json({ msg: "Bank successfully added." });
  },

  dashboardSummary: async (req: Request, res: Response) => {
    const { email, companyId } = req.user;
    const { company } = await userNdCompany({ email, companyId });
    if (!company) throw new BadRequestError("No company found!");

    // Parallel data fetching
    const [transactions, products, lowStockProducts, outOfStock] =
      await Promise.all([
        prisma.transaction.findMany({
          where: {
            companyId: company.id,
            tenantId: company.tenantId,
            type: { in: ["SALE", "BULK_SALE"] },
          },
          include: {
            TransactionItem: { include: { Product: true } },
            Payments: {
              include: { payments: { orderBy: { createdAt: "desc" } } },
            },
          },
        }),

        prisma.product.findMany({
          where: { companyId: company.id, tenantId: company.tenantId },
        }),

        prisma.product.findMany({
          where: {
            companyId: company.id,
            tenantId: company.tenantId,
            quantity: { lte: 20 },
          },
          select: { productName: true, quantity: true },
        }),

        prisma.product.findMany({
          where: {
            companyId: company.id,
            tenantId: company.tenantId,
            quantity: { lte: 0 },
          },
          select: { productName: true, updatedAt: true },
        }),
      ]);

    // Initialize monthly metrics
    const months = Array.from({ length: 12 }, (_, i) =>
      new Date(2023, i).toLocaleString("default", { month: "short" })
    );

    const monthlyCardData = months.map((month, index) => ({
      month,
      salesAmount: 0,
      purchaseAmount: 0, // Will store COGS + remaining inventory
      cogs: 0, // Cost of Goods Sold
      inventoryValue: 0, // Remaining inventory value
      profit: 0,
      profitPercent: 0,
    }));

    // Track inventory by creation month
    const inventoryByMonth = new Map<number, number>();

    // 1. Process products to track initial inventory
    products.forEach((p) => {
      const createdMonth = new Date(p.createdAt).getMonth();
      const value = Number(p.costPrice) * Number(p.quantity);
      inventoryByMonth.set(
        createdMonth,
        (inventoryByMonth.get(createdMonth) || 0) + value
      );
    });

    transactions.forEach((t) => {
      const saleMonth = new Date(t.createdAt).getMonth();
      const monthData = monthlyCardData[saleMonth];

      // Track sales
      const saleAmount = Number(t.Payments[0]?.payments[0]?.totalPay || 0);
      monthData.salesAmount += saleAmount;

      t.TransactionItem.forEach((item) => {
        const product = item.Product;
        const createdMonth = new Date(product.createdAt).getMonth();
        const quantity = Number(item.quantity);
        const costPrice = Number(product.costPrice);

        const itemCOGS = costPrice * quantity;
        const remainingProductPrice = costPrice * Number(product.quantity);
        monthlyCardData[createdMonth].cogs += itemCOGS;
      });
    });

    // 3. Calculate final monthly values
    monthlyCardData.forEach((monthData, index) => {
      const initialInventory = inventoryByMonth.get(index) || 0;

      monthData.inventoryValue = initialInventory;
      monthData.purchaseAmount = initialInventory + monthData.cogs;
      monthData.profit = monthData.salesAmount - monthData.cogs;
      monthData.profitPercent =
        monthData.cogs > 0 ? (monthData.profit / monthData.cogs) * 100 : 0;
    });

    const cardData = transactions.map((t) => ({
      topSelling: t.TransactionItem.map((i) => {
        return {
          soldQty: i.quantity,
          soldAmount: i.totalPrice,
          productName: i.Product.productName,
          remainingQty: i.Product.quantity,
          id: i.Product.id,
        };
      }),
    }));

    // Top Selling Product
    const allTopSelling = cardData.flatMap((c) => c.topSelling);

    // Aggregate products by id to sum up quantities and amounts
    const productMap = allTopSelling.reduce((map, product) => {
      const key = product.id;
      if (!map.has(key)) {
        map.set(key, {
          productName: product.productName,
          soldQty: 0,
          soldAmount: 0,
          remainingQty: product.remainingQty,
        });
      }
      const existing = map.get(key);
      existing.soldQty += Number(product.soldQty);
      existing.soldAmount += Number(product.soldAmount);
      existing.remainingQty = product.remainingQty; // Take the last remainingQty
      return map;
    }, new Map());

    // Convert to array and sort by sold quantity (descending)
    const allTopSellingProducts = Array.from(productMap.values())
      .sort((a, b) => b.soldQty - a.soldQty)
      .map((product) => ({
        productName: product.productName,
        soldQty: String(product.soldQty),
        remainingQty: String(product.remainingQty),
        soldAmount: String(product.soldAmount),
      }));

    const topSellingProduct =
      allTopSellingProducts.length > 0
        ? allTopSellingProducts
        : {
            productName: "",
            soldQty: "",
            remainingQty: "",
            soldAmount: "",
          };

    // Initialize monthly data structure
    const monthlyData = Object.fromEntries(
      months.map((m) => [m, { sales: 0, purchases: 0 }])
    );

    // Process transactions for sales and sold products' purchases
    transactions.forEach((t) => {
      const month = new Date(t.createdAt).toLocaleString("default", {
        month: "short",
      });
      const sales = Number(t.Payments[0]?.payments[0]?.totalPay || 0);
      const cost = t.TransactionItem.reduce(
        (sum, item) =>
          sum + Number(item.Product.costPrice) * Number(item.quantity),
        0
      );

      monthlyData[month].sales += sales;
      monthlyData[month].purchases += cost;
    });

    products.forEach((p) => {
      if (p.quantity > 0) {
        // Only include products still in inventory
        const month = new Date(p.createdAt).toLocaleString("default", {
          month: "short",
        });
        const purchaseValue = Number(p.costPrice) * Number(p.quantity);
        monthlyData[month].purchases += purchaseValue;
      }
    });

    // Convert to final array format
    const data = months.map((month) => ({
      month,
      sales: monthlyData[month].sales,
      purchases: monthlyData[month].purchases,
    }));

    // Initialize data structures
    const productMetrics = new Map<
      string,
      {
        name: string;
        revenue: number;
        cogs: number;
        unitsSold: number;
        currentStock: number;
      }
    >();

    // Preload current product quantities
    products.forEach((p) => {
      productMetrics.set(p.id, {
        name: p.productName,
        revenue: 0,
        cogs: 0,
        unitsSold: 0,
        currentStock: Number(p.quantity),
      });
    });

    // Single pass through transactions
    transactions.forEach((t) => {
      const transactionDate = new Date(t.createdAt);

      let transactionCogs = 0;
      let transactionItemsSold = 0;

      t.TransactionItem.forEach((item) => {
        const product = item.Product;
        const quantity = Number(item.quantity);
        const costPrice = Number(product.costPrice);
        const sellingPrice = Number(product.sellingPrice);

        // Update product metrics
        const productData = productMetrics.get(product.id);
        if (productData) {
          productData.unitsSold += quantity;
          productData.revenue += quantity * sellingPrice;
          productData.cogs += quantity * costPrice;
          productData.currentStock = Number(product.quantity); // Update with latest stock
        }

        transactionCogs += quantity * costPrice;
        transactionItemsSold += quantity;
      });
    });

    // Track product performance
    const productMetricMap = new Map<
      string,
      {
        name: string;
        revenue: number;
        cogs: number;
        unitsSold: number;
      }
    >();

    // Process transactions
    transactions.forEach((t) => {
      // Calculate COGS and product metrics
      let transactionCOGS = 0;
      t.TransactionItem.forEach((item) => {
        const product = item.Product;
        const qty = Number(item.quantity);
        const cost = Number(product.costPrice);

        // Update COGS
        transactionCOGS += qty * cost;

        // Update product metrics
        const productData = productMetricMap.get(product.id) || {
          name: product.productName,
          revenue: 0,
          cogs: 0,
          unitsSold: 0,
        };

        productData.revenue += qty * Number(product.sellingPrice);
        productData.cogs += qty * cost;
        productData.unitsSold += qty;
        productMetricMap.set(product.id, productData);
      });
    });

    // Prepare top products
    const productArray = Array.from(productMetricMap.values()).map((p) => ({
      ...p,
      profit: p.revenue - p.cogs,
    }));

    const topRevenue = productArray
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((p) => ({
        product: p.name,
        revenue: p.revenue,
        unitsSold: p.unitsSold,
      }));

    const topProfit = productArray
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10)
      .map((p) => ({
        product: p.name,
        profit: p.profit,
        margin: ((p.profit / p.revenue) * 100).toFixed(1) + "%",
      }));

    const returnedData = {
      overview: {
        cardData: monthlyCardData.map((m) => ({
          month: m.month,
          salesAmount: m.salesAmount,
          purchaseAmount: m.purchaseAmount,
          inventoryValue: m.inventoryValue,
          profit: m.profit,
          profitPercent: Number(m.profitPercent.toFixed(2)),
          cogs: m.cogs,
        })),
        lowStockProducts,
        outOfStock,
        topSellingProduct,
        data,
      },
      products: { topRevenue, topProfit },
    };

    res.status(StatusCodes.OK).json({ msg: "Success", data: returnedData });
  },
};
