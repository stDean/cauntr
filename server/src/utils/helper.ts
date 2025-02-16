import { BadRequestError } from "../errors";
import { prisma } from "./prisma.h";

export function parseDate(dateInput: string | number | Date): Date | null {
	if (dateInput instanceof Date) {
		return new Date(dateInput);
	}

	if (typeof dateInput === "number") {
		return new Date(dateInput);
	}

	if (typeof dateInput === "string") {
		const parsedDate = new Date(dateInput);
		if (!isNaN(parsedDate.getTime())) {
			return parsedDate;
		}

		// Handle formats manually if needed
		const formats = [
			/^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
			/^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
			/^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
			/^\d{2}\/\d{2}\/\d{4}$/, // DD/MM/YYYY
		];

		for (const format of formats) {
			if (format.test(dateInput)) {
				const parts = dateInput.split(/[-\/]/).map(Number);
				if (format === formats[0] || format === formats[2]) {
					return new Date(parts[0], parts[1] - 1, parts[2]);
				} else if (format === formats[1]) {
					return new Date(parts[2], parts[0] - 1, parts[1]);
				} else if (format === formats[3]) {
					return new Date(parts[2], parts[1] - 1, parts[0]);
				}
			}
		}
	}

	return null; // Return null if parsing fails
}

export const generateSKU = (type: string) => {
  if (!type) return;

  const prefix = type.slice(0, 3).toUpperCase();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${random}`;
};

export const getOrCreateSupplier = async (supplierData: {
  supplierName: string;
  supplierPhone: string;
}) => {
  const { supplierName, supplierPhone } = supplierData;

  const existingSupplier = await prisma.supplier.findUnique({
    where: {
      name_contact: {
        name: supplierName,
        contact: supplierPhone,
      },
    },
  });

  return (
    existingSupplier ||
    (await prisma.supplier.create({
      data: {
        name: supplierName,
        contact: supplierPhone,
      },
    }))
  );
};

export const userNdCompany = async ({
  email,
  companyId,
}: {
  email: string;
  companyId: string;
}) => {
  const company = await prisma.company.findUnique({
    where: { company_email: email, id: companyId },
    select: { tenantId: true, id: true },
  });

  if (!company) {
    throw new BadRequestError("Company not found");
  }

  const user = await prisma.user.findUnique({
    where: { email, companyId },
    select: { id: true },
  });

  if (!user) {
    throw new BadRequestError("User not found");
  }

  return { user, company };
};