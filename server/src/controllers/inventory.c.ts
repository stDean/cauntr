import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, NotFoundError } from "../errors";
import { prisma } from "../utils/prisma.h";
import {
	generateSKU,
	getOrCreateSupplier,
	userNdCompany,
	parseDate,
} from "../utils/helper";
import { Condition, Product } from "@prisma/client";

interface ProductInput {
	productName: string;
	brand: string;
	productType: string;
	sellingPrice: number;
	supplierName: string;
	supplierPhone: string;
	sku?: string;
	description?: string;
	costPrice?: number;
	serialNo?: string;
	condition?: string;
	quantity?: number;
	purchaseDate?: Date;
}

const productHelper = async ({
	sku,
	email,
	companyId,
}: {
	sku: string;
	email: string;
	companyId: string;
}) => {
	const { company } = await userNdCompany({ email, companyId });
	const product: Product | null = await prisma.product.findUnique({
		where: {
			sku_companyId_tenantId: {
				sku,
				companyId: company.id,
				tenantId: company.tenantId,
			},
		},
	});

	if (!product) {
		throw new NotFoundError("Product not found or has been deleted.");
	}

	return { company, product };
};

const validateProduct = (product: ProductInput, isBulk = false) => {
	const errors: { field: string; message: string }[] = [];
	const requiredFields = [
		"productName",
		"productType",
		"sellingPrice",
		"brand",
		"supplierName",
		"supplierPhone",
	];

	requiredFields.forEach(field => {
		if (!product[field as keyof ProductInput]?.toString().trim()) {
			errors.push({
				field,
				message: `${field} is required`,
			});
		}
	});

	if (!product.sku && !generateSKU(product.productType)) {
		errors.push({
			field: "sku",
			message: "sku is required",
		});
	}

	return errors.length > 0 ? { errors, success: false } : { success: true };
};

export const InventoryCtrl = {
	/**
	 * Create a single product.
	 * - Retrieves the current user and company info.
	 * - Validates the product input.
	 * - Retrieves or creates the supplier.
	 * - Normalizes the product condition.
	 * - Creates the product record in the database.
	 */
	createProduct: async (req: Request, res: Response) => {
		// Extract companyId and email from the authenticated user.
		const { companyId, email } = req.user;
		// Cast the request body to the expected ProductInput type.
		const productInput = req.body as ProductInput;

		// Retrieve the user and company data based on the provided credentials.
		const { user, company } = await userNdCompany({ email, companyId });
		// Validate the product input; if invalid, return a BAD_REQUEST response.
		const validationResult = validateProduct(productInput);
		if (!validationResult.success) {
			res.status(StatusCodes.BAD_REQUEST).json({
				msg: "Product creation failed.",
				success: false,
				errors: validationResult.errors,
			});
			return;
		}

		// Retrieve or create the supplier using the supplier's name and phone number.
		const supplier = await getOrCreateSupplier({
			supplierName: productInput.supplierName,
			supplierPhone: productInput.supplierPhone,
		});

		// Set the product condition; default to NEW if the provided condition is not valid.
		let condition: Condition = Condition.NEW;
		if (productInput.condition) {
			const upperCondition = productInput.condition.toUpperCase();
			condition = Object.values(Condition).includes(upperCondition as Condition)
				? (upperCondition as Condition)
				: Condition.NEW;
		}

		// Create the product record using the validated and normalized data.
		const createdProduct = await prisma.product.create({
			data: {
				tenantId: company.tenantId,
				sku: productInput.sku || generateSKU(productInput.productType)!,
				productName: productInput.productName,
				description: productInput.description || null,
				brand: productInput.brand,
				productType: productInput.productType,
				costPrice: Number(productInput.costPrice || 0),
				sellingPrice: Number(productInput.sellingPrice),
				serialNo: productInput.serialNo || null,
				purchaseDate: productInput.purchaseDate
					? new Date(productInput.purchaseDate)
					: new Date(),
				condition,
				quantity: Number(productInput.quantity || 1),
				createdById: user.id,
				supplierId: supplier.id,
				companyId: company.id,
			},
		});

		// Return a CREATED response with the created product.
		res.status(StatusCodes.CREATED).json({
			msg: "Product created successfully",
			success: true,
			data: createdProduct,
		});
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
		const { companyId, email } = req.user;

		// Ensure that the request body is an array.
		if (!Array.isArray(req.body)) {
			throw new BadRequestError("Request body must be an array of products");
		}

		// Retrieve the current user and company information.
		const { user, company } = await userNdCompany({ email, companyId });

		// Phase 1: Validate each product in the request body.
		const validationErrors = req.body
			.map((product, index) => {
				const requiredFields = [
					"Product Name",
					"Item Type",
					"Selling Price",
					"Brand",
					"Supplier Name",
					"Supplier Phone Number",
				];
				// Identify missing required fields.
				const missing = requiredFields.filter(
					field => !product[field]?.toString().trim()
				);
				return missing.length ? { index, missing } : null;
			})
			.filter(Boolean);

		// If any validation errors are found, return them.
		if (validationErrors.length > 0) {
			res.status(StatusCodes.BAD_REQUEST).json({
				msg: "Validation errors in input data",
				errors: validationErrors,
			});
			return;
		}

		// Phase 2: Process supplier information.
		const supplierDetails = req.body.map(p => ({
			name: p["Supplier Name"].trim(),
			contact: p["Supplier Phone Number"].toString().trim(),
		}));
		// Remove duplicate suppliers.
		const uniqueSuppliers = [
			...new Map(
				supplierDetails.map(s => [`${s.name}|${s.contact}`, s])
			).values(),
		];

		// Fetch suppliers that already exist in the database.
		const existingSuppliers = await prisma.supplier.findMany({
			where: {
				OR: uniqueSuppliers.map(s => ({
					AND: [{ name: s.name }, { contact: s.contact }],
				})),
			},
		});

		// Identify suppliers that need to be created.
		const newSuppliers = uniqueSuppliers.filter(
			s =>
				!existingSuppliers.some(
					es => es.name === s.name && es.contact === s.contact
				)
		);

		// Create any new suppliers in bulk, skipping duplicates.
		if (newSuppliers.length > 0) {
			await prisma.supplier.createMany({
				data: newSuppliers,
				skipDuplicates: true,
			});
		}

		// Fetch all suppliers after creation.
		const allSuppliers = await prisma.supplier.findMany({
			where: {
				OR: uniqueSuppliers.map(s => ({
					AND: [{ name: s.name }, { contact: s.contact }],
				})),
			},
		});

		// Phase 3: Process each product for creation.
		const results: any = [];
		const errors: any = [];

		await Promise.all(
			req.body.map(async product => {
				try {
					// Find the corresponding supplier for the current product.
					const supplier = allSuppliers.find(
						s =>
							s.name === product["Supplier Name"].trim() &&
							s.contact === product["Supplier Phone Number"].toString().trim()
					);
					if (!supplier) {
						throw new Error("Associated supplier not found");
					}

					// Prepare product data for creation.
					const productData: any = {
						tenantId: company.tenantId,
						sku: product["SKU"] || generateSKU(product["Item Type"]),
						productName: product["Product Name"],
						description: product["Description"] || null,
						brand: product["Brand"],
						productType: product["Item Type"],
						costPrice: Number(product["Cost Price"]) || 0,
						sellingPrice: Number(product["Selling Price"]),
						serialNo: product["Serial Number"],
						purchaseDate: parseDate(product["Purchase Date"]) || new Date(),
						condition: product["Condition"]
							? (product["Condition"].toUpperCase() as Condition)
							: Condition.NEW,
						quantity: Number(product["Quantity"]) || 1,
						createdById: user.id,
						supplierId: supplier.id,
						companyId: company.id,
					};

					// Create the product and add the result to the results array.
					const result = await prisma.product.create({
						data: productData,
					});
					results.push(result);
				} catch (error: any) {
					// On error, record the error message along with the product's serial number.
					errors.push({
						product: product["Serial Number"],
						error: error.message.split("\n").shift() || "Duplicate entry.",
					});
				}
			})
		);

		// Phase 4: Respond based on whether there were errors.
		if (errors.length > 0) {
			res.status(StatusCodes.MULTI_STATUS).json({
				created: results.length,
				failed: errors.length,
				data: results,
				errors,
			});
			return;
		}

		res.status(StatusCodes.CREATED).json({
			message: "All products created successfully",
			data: results,
			success: true,
		});
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
		const products = await prisma.product.groupBy({
			where: { companyId: company.id, tenantId: company.tenantId },
			by: ["productType", "brand"],
			_count: {
				productType: true,
			},
			_sum: {
				quantity: true,
			},
		});

		res.status(StatusCodes.OK).json({
			success: true,
			data: products,
		});
	},

	/**
	 * Retrieve products filtered by a given product type and brand.
	 */
	getProductsByTypeAndBrand: async (req: Request, res: Response) => {
		const { type, brand } = req.params;
		const { email, companyId } = req.user;
		const { company } = await userNdCompany({ email, companyId });

		// Fetch products matching the specified type and brand.
		const products = await prisma.product.findMany({
			where: {
				companyId: company.id,
				tenantId: company.tenantId,
				productType: type,
				brand,
			},
		});

		if (products.length === 0) {
			throw new NotFoundError("No products found");
		}

		res.status(StatusCodes.OK).json({
			success: true,
			data: products,
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
			"sellingPrice",
			"costPrice",
			"sku",
			"condition",
			"quantity",
			"purchaseDate",
		];

		const updateData: Partial<Product> = {};
		// Filter and assign allowed fields from the request body.
		Object.keys(body).forEach(key => {
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
		const updatedProduct = await prisma.$transaction(async tx => {
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
				ProductDeletionEvent: {
					some: {},
				},
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
			.map(product => {
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
			.filter(p => p !== null);

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
		const updatedProduct = await prisma.$transaction(async tx => {
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
			await prisma.$transaction(async tx => {
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
				await prisma.$transaction(async tx => {
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
			},
		});
	},
};
