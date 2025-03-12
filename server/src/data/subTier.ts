export const subscriptionTiers = {
	personal_monthly: {
		name: "Personal(monthly)",
		price: 1000000,
		stripePriceId: process.env.STRIPE_PERSONAL_MONTHLY_PRICE_ID,
	},
	personal_yearly: {
		name: "Personal(yearly)",
		price: 10200000,
		stripePriceId: process.env.STRIPE_PERSONAL_YEARLY_PRICE_ID,
	},
	team_monthly: {
		name: "Team(monthly)",
		price: 1450000,
		stripePriceId: process.env.STRIPE_TEAM_MONTHLY_PRICE_ID,
	},
	team_yearly: {
		name: "Team(yearly)",
		price: 14400000,
		stripePriceId: process.env.STRIPE_TEAM_YEARLY_PRICE_ID,
	},
	enterprise_monthly: {
		name: "Enterprise(monthly)",
		price: 17000000,
		stripePriceId: process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID,
	},
	enterprise_yearly: {
		name: "Enterprise(yearly)",
		price: 17400000,
		stripePriceId: process.env.STRIPE_ENTERPRISE_YEAR,
	},
} as const;

export type TierNames = keyof typeof subscriptionTiers;

export function getTierByPriceId(stripePriceId: string) {
	return Object.values(subscriptionTiers).find(
		tier => tier.stripePriceId === stripePriceId
	);
}
