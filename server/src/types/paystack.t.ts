// types/paystack.d.ts
declare module "@paystack/paystack-sdk" {
	class Paystack {
		constructor(secretKey: string); // Key as a string, not an object
		transaction: {
			initialize(params: any): Promise<any>;
			verify({ reference }: { reference: string }): Promise<any>;
			list(params?: any): Promise<any>;
		};
	}

	export default Paystack;
}
