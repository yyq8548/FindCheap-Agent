import { z } from "zod";

export const CouponEligibilityRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FIRST_ORDER") }).strict(),
  z.object({ type: z.literal("SUBSCRIPTION") }).strict(),
  z.object({ type: z.literal("PAYMENT_METHOD"), paymentMethod: z.string().min(1) }).strict(),
  z.object({ type: z.literal("ZIP_CODE"), zipCode: z.string().min(1) }).strict()
]);

export type CouponEligibilityRule = z.infer<typeof CouponEligibilityRuleSchema>;

export const UserPriceContextSchema = z
  .object({
    memberships: z.array(z.string().min(1)),
    isFirstOrder: z.boolean(),
    hasSubscription: z.boolean(),
    paymentMethods: z.array(z.string().min(1)),
    zipCode: z.string().min(1).optional()
  })
  .strict();

export type UserPriceContext = z.infer<typeof UserPriceContextSchema>;

export function ruleSatisfied(rule: CouponEligibilityRule, user: UserPriceContext): boolean {
  switch (rule.type) {
    case "FIRST_ORDER":
      return user.isFirstOrder;
    case "SUBSCRIPTION":
      return user.hasSubscription;
    case "PAYMENT_METHOD":
      return user.paymentMethods.includes(rule.paymentMethod);
    case "ZIP_CODE":
      return user.zipCode === rule.zipCode;
  }
}

export function describeRule(rule: CouponEligibilityRule): string {
  switch (rule.type) {
    case "FIRST_ORDER":
      return "Requires first order";
    case "SUBSCRIPTION":
      return "Requires subscription";
    case "PAYMENT_METHOD":
      return `Requires payment method: ${rule.paymentMethod}`;
    case "ZIP_CODE":
      return `Requires ZIP code: ${rule.zipCode}`;
  }
}
