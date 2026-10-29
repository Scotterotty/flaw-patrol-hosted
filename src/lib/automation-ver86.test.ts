import { describe, expect, it } from "vitest";
import { folderFromClass, sameTitle, titleFromTest } from "./automation";

describe("automation upload (ver_86)", () => {
  it("matches a test to a case with the same title", () => {
    expect(sameTitle("Pay with card", titleFromTest("pay_with_card"))).toBe(true);
    expect(sameTitle("Pay with card", titleFromTest("PayWithCard"))).toBe(true);
    expect(sameTitle("Pay with card", titleFromTest("pay_with_cash"))).toBe(false);
    expect(sameTitle("", "")).toBe(false);
  });
  it("gives each test class a readable folder name", () => {
    expect(folderFromClass("checkout.CartTest")).toBe("Cart");
    expect(folderFromClass("checkout.PayTest")).toBe("Pay");
    expect(folderFromClass("com.acme.CheckoutFlowSpec")).toBe("Checkout flow");
    expect(folderFromClass("src/cart.test.js")).toBe("Cart");
    expect(folderFromClass("api")).toBe("API");
    expect(titleFromTest("GET /orders returns 200")).toBe("GET /orders returns 200");
    expect(titleFromTest("AddItemToCart")).toBe("Add item to cart");
    expect(folderFromClass("")).toBe("");
  });
});

describe("nearTitle (ver_94)", () => {
  it("ignores case and simple endings", async () => {
    const { nearTitle } = await import("./automation");
    expect(nearTitle("Sign in with SSO", "signs in with sso")).toBe(true);
    expect(nearTitle("Add item to cart", "Adds items to cart")).toBe(true);
    expect(nearTitle("Checkout loads", "Checkout loading")).toBe(true);
    expect(nearTitle("Add item to cart", "Remove item from cart")).toBe(false);
  });
});

describe("ver_95 plain titles", () => {
  it("drops the describe() path from Playwright test names", () => {
    expect(titleFromTest("Shop \u203a adds an item to the cart")).toBe("Adds an item to the cart");
    expect(folderFromClass("shop.spec.ts")).toBe("Shop");
  });
});
