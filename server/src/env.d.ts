// src/env.d.ts
declare global {
	namespace NodeJS {
		interface ProcessEnv {
			PORT?: string;
			NODE_ENV?: "development" | "production";
			DATABASE_URL: string;
			SMTP_HOST: string;
			SMTP_PORT: string;
			SMTP_SECURE: string;
			SMTP_USER: string;
			SMTP_PASS: string;
			EMAIL_FROM: string;
			PAY_STACK_SECRET_KEY: string;
			PAY_STACK_PUBLIC_KEY: string;
			PAY_STACK_REDIRECT_URL: string;
			PAY_STACK_REDIRECT_REACTIVATE_URL: string;
			JWT_SECRET: string;
			STRIPE_SECRET_KEY: string;
			STRIPE_PUBLIC_KEY: string;
			STRIPE_REDIRECT_SUCCESS_URL: string;
			STRIPE_REDIRECT_CANCEL_URL: string;
			STRIPE_PERSONAL_MONTHLY_PRICE_ID: string;
			STRIPE_PERSONAL_YEARLY_PRICE_ID: string;
			STRIPE_TEAM_MONTHLY_PRICE_ID: string;
			STRIPE_TEAM_YEARLY_PRICE_ID: string;
			STRIPE_ENTERPRISE_MONTHLY_PRICE_ID: string;
			STRIPE_ENTERPRISE_YEAR: string;
			STRIPE_WEBHOOK_SECRET: string;
		}
	}
}

export {};
