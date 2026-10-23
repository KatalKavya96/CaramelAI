# tillroll

Prints a receipt for a cart file.

```sh
bun run src/cli.ts examples/cart.json
bun run src/cli.ts examples/cart.json --code SAVE10
```

A cart is a JSON array of `{ "sku", "name", "price", "qty" }`, with `price` in dollars.
Money is handled as integer cents inside the program so totals never drift.

Discounts are rounded down to the cent (in the shop's favour, as the accountant asked).
Sales tax is 8% of the discounted subtotal, rounded half up.
