// types/paystack.d.ts
declare module "@paystack/paystack-sdk" {
	class Paystack {
		constructor(secretKey: string); // Key as a string, not an object
		transaction: {
			initialize(params: any): Promise<any>;
			verify({ reference }: { reference: string }): Promise<any>;
			list(params?: any): Promise<any>;
		};
		subscription: {
			create({
				customer,
				plan,
				authorization,
				start_date,
			}: {
				customer: string;
				plan: string;
				authorization: string;
				start_date: Date;
			}): Promise<any>;
			list({ code }: { code?: string }): Promise<any>;
		};
	}

	export default Paystack;
}
