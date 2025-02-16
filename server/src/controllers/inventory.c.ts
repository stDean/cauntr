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
	createProduct: async (req: Request, res: Response) => {
		const { companyId, email } = req.user;
		const productInput = req.body as ProductInput;

		const { user, company } = await userNdCompany({ email, companyId });
		const errors = validateProduct(productInput);
		if (errors.errors) {
			res.status(StatusCodes.BAD_REQUEST).json({
				msg: "Product creation failed.",
				success: false,
				errors: errors.errors,
			});

			return;
		}

		const supplier = await getOrCreateSupplier({
			supplierName: productInput.supplierName,
			supplierPhone: productInput.supplierPhone,
		});

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
				condition:
					(productInput.condition!.toUpperCase() as Condition) || Condition.NEW,
				quantity: Number(productInput.quantity || 1),
				createdById: user.id,
				supplierId: supplier.id,
				companyId: company.id,
			},
		});

		res.status(StatusCodes.CREATED).json({
			msg: "Product created successfully",
			success: true,
			data: createdProduct,
		});
	},
	createProducts: async (req: Request, res: Response) => {
		const { companyId, email } = req.user;

		// Validate input format
		if (!Array.isArray(req.body)) {
			throw new BadRequestError("Request body must be an array of products");
		}

		const { user, company } = await userNdCompany({ email, companyId });

		// Phase 1: Initial Validation
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

				const missing = requiredFields.filter(
					field => !product[field]?.toString().trim()
				);

				return missing.length ? { index, missing } : null;
			})
			.filter(Boolean);

		if (validationErrors.length > 0) {
			res.status(StatusCodes.BAD_REQUEST).json({
				msg: "Validation errors in input data",
				errors: validationErrors,
			});

			return;
		}

		// Phase 2: Supplier Processing
		const supplierDetails = req.body.map(p => ({
			name: p["Supplier Name"].trim(),
			contact: p["Supplier Phone Number"].toString().trim(),
		}));

		const uniqueSuppliers = [
			...new Map(
				supplierDetails.map(s => [`${s.name}|${s.contact}`, s])
			).values(),
		];

		// Bulk supplier fetch and create
		const existingSuppliers = await prisma.supplier.findMany({
			where: { OR: uniqueSuppliers.map(s => s) },
		});

		const newSuppliers = uniqueSuppliers.filter(
			s =>
				!existingSuppliers.some(
					es => es.name === s.name && es.contact === s.contact
				)
		);

		if (newSuppliers.length > 0) {
			await prisma.supplier.createMany({
				data: newSuppliers,
				skipDuplicates: true,
			});
		}

		const allSuppliers = await prisma.supplier.findMany({
			where: { OR: uniqueSuppliers.map(s => s) },
		});

		// Phase 3: Product Processing
		const results: any = [];
		const errors: any = [];

		await Promise.all(
			req.body.map(async product => {
				try {
					// Find corresponding supplier
					const supplier = allSuppliers.find(
						s =>
							s.name === product["Supplier Name"].trim() &&
							s.contact === product["Supplier Phone Number"].toString().trim()
					);

					if (!supplier) {
						throw new Error("Associated supplier not found");
					}

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
						condition: product["Condition"] || "NEW",
						quantity: Number(product["Quantity"]) || 1,
						createdById: user.id,
						supplierId: supplier.id,
						companyId: company.id,
					};

					// Create product with conflict checking
					const result = await prisma.product.create({
						data: productData,
					});

					results.push(result);
				} catch (error: any) {
					errors.push({
						product: product["Serial Number"],
						error: error.message.split("\n").shift() || "Duplicate entry.",
					});
				}
			})
		);

		// Phase 4: Response Handling
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
	getProductCountsByTypeAndBrand: async (req: Request, res: Response) => {
		const { email, companyId } = req.user;
		const { company } = await userNdCompany({ email, companyId });

		const products = await prisma.product.groupBy({
			where: { companyId: company.id, tenantId: company.tenantId },
			by: ["productType", "brand"],
			_count: {
				productType: true,
			},
			_sum: {
				quantity: true, // Sums up the total quantity instead of counting records
			},
		});

		res.status(StatusCodes.OK).json({
			success: true,
			data: products,
		});
	},
	getProductsByTypeAndBrand: async (req: Request, res: Response) => {
		const { type, brand } = req.params;
		const { email, companyId } = req.user;
		const { company } = await userNdCompany({ email, companyId });

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
	getProductBySKU: async (req: Request, res: Response) => {
		const {
			params: { sku },
			user: { email, companyId },
		} = req;
		const { product } = await productHelper({ sku, email, companyId });

		res.status(StatusCodes.OK).json({
			success: true,
			data: product,
		});
	},
	updateProduct: async (req: Request, res: Response) => {
		const {
			body,
			params: { sku },
			user: { email, companyId },
		} = req;
		const { company } = await productHelper({ sku, email, companyId });

		const updatedProduct = await prisma.product.update({
			where: {
				sku_companyId_tenantId: {
					sku,
					companyId: company.id,
					tenantId: company.tenantId,
				},
			},
			data: { ...body },
		});

		res.status(StatusCodes.OK).json({
			success: true,
			data: updatedProduct,
			mag: "Product updated successfully",
		});
	},
	softDeleteProduct: async (req: Request, res: Response) => {
		const {
			params: { sku },
			user: { email, companyId },
			body: { deleteQuantity },
		} = req;
		const quantityToDelete = Number(deleteQuantity);
		// Validate deletion quantity
		if (!quantityToDelete || quantityToDelete <= 0) {
			throw new BadRequestError("Invalid delete quantity provided.");
		}

		const { company, product } = await productHelper({ sku, email, companyId });

		// Validate quantity
		if (quantityToDelete > product.quantity!) {
			throw new BadRequestError(
				"Delete quantity exceeds available product quantity.."
			);
		}

		// Log the deletion event in a transaction and update the product's active quantity
		const updatedProduct = await prisma.$transaction(async tx => {
			// Update product active quantity
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

			// Log the deletion event
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
	getSoftDeletedProductsUsingEvents: async (req: Request, res: Response) => {
		const { email, companyId } = req.user;
		const { company } = await userNdCompany({ email, companyId });

		// Fetch products with their deletion events
		// const products = await prisma.product.findMany({
		// 	where: {
		// 		companyId: company.id,
		// 		tenantId: company.tenantId,
		// 	},
		// 	include: {
		// 		ProductDeletionEvent: true,
		// 	},
		// });

		const products = await prisma.product.findMany({
			where: {
				companyId: company.id,
				tenantId: company.tenantId,
				ProductDeletionEvent: {
					some: {}, // Only include products that have at least one deletion event
				},
			},
			select: {
				sku: true,
				productName: true,
				quantity: true, // Active quantity remaining
				ProductDeletionEvent: {
					select: {
						deletionDate: true,
						quantity: true,
					},
					orderBy: {
						deletionDate: "asc", // Order events by deletion date if needed
					},
				},
			},
		});

		if (!products.length) {
			throw new NotFoundError("No products found");
		}

		// For each product, calculate the total soft-deleted quantity and the most recent deletion date
		const softDeletedProducts = products
			.map(product => {
				const totalDeleted = product.ProductDeletionEvent.reduce(
					(sum, event) => sum + event.quantity,
					0
				);
				if (totalDeleted > 0) {
					// Get the most recent deletion date
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

		res.status(200).json({
			success: true,
			data: { products, softDeletedProducts },
		});
	},
	restoreProductQuantity: async (req: Request, res: Response) => {
		const {
			params: { sku },
			user: { email, companyId },
			body: { restoreQuantity },
		} = req;
		const quantityToRestore = Number(restoreQuantity);

		if (!quantityToRestore || quantityToRestore <= 0) {
			throw new BadRequestError("Invalid restore quantity provided.");
		}

		const { company, product } = await productHelper({ sku, email, companyId });

		// Retrieve all deletion events for the product, ordered by deletionDate ascending
		const deletionEvents = await prisma.productDeletionEvent.findMany({
			where: { productId: product.id },
			orderBy: { deletionDate: "asc" },
		});

		// Calculate the total deleted quantity from these events
		const totalDeleted = deletionEvents.reduce(
			(sum, event) => sum + event.quantity,
			0
		);

		if (quantityToRestore > totalDeleted) {
			throw new BadRequestError(
				"Restore quantity exceeds deleted product quantity."
			);
		}

		// Use a transaction to update the product and adjust deletion events atomically
		const updatedProduct = await prisma.$transaction(async tx => {
			// Increase the product's active quantity
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

			// Process deletion events in order until the restore quantity is fully applied
			let remainingToRestore = quantityToRestore;
			for (const event of deletionEvents) {
				if (remainingToRestore <= 0) break;

				if (event.quantity > remainingToRestore) {
					// Calculate the new quantity after restoring some units
					const newQuantity = event.quantity - remainingToRestore;
					if (newQuantity === 0) {
						// If the updated quantity is 0, remove the event log
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
					// If the event's quantity is less than or equal to the remaining restore quantity, delete the event
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
};
