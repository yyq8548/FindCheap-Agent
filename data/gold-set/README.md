# Product matching gold set

`products.jsonl` is a strict, one-case-per-line, human-reviewed matching evaluation set. Each record must conform to `schema.json` and the canonical product and candidate contracts consumed by `matchProduct`.

The three seed cases only verify the evaluation plumbing. Phase 0 must expand this file to at least 500 human-reviewed records before treating its metrics as a launch-quality benchmark. Do not synthesize or label records merely to reach that target.
