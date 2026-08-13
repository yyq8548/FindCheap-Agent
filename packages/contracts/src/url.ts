import { z } from "zod";

export const HttpsUrlSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    context.addIssue({ code: "custom", message: "public URL must use HTTPS" });
  }
  if (url.username || url.password) {
    context.addIssue({ code: "custom", message: "public URL must not contain credentials" });
  }
});
