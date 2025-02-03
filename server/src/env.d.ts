// src/env.d.ts
declare global {
	namespace NodeJS {
		interface ProcessEnv {
			PORT?: string;
			NODE_ENV?: "development" | "production";
      DATABASE_URL: string;
		}
	}
}

export {};
