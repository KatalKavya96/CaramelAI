# tidy-slug

URL slugs that survive accents, punctuation and length limits.

```sh
bun add tidy-slug
```

## Quick start

```ts
import { slugify } from "tidy-slug";

slugify("Hello, World!");
// => "hello-world"

slugify("Crème Brûlée Recipe", { sep: "_" });
// => "creme_brulee_recipe"

slugify("A very long blog post title about slugs", { maxLength: 20 });
// => "a-very-long-blog-pos"
```

## Options

| Option      | Default | Meaning                                  |
|-------------|---------|------------------------------------------|
| `sep`       | `"-"`   | Put between words.                       |
| `maxLength` | none    | Longest slug allowed, in characters.     |
