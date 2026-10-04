# model-evidence contract 2.0

This is the authoritative schema for what the acceptance judge takes in and
what it gives back. The judge is task-blind: it sees binary rows grouped into
named views, and answers Pass, Fail, or Insufficient evidence on three axes
(performance, stability, reproducibility) per view and for the bundle. Systems
under test are reduced to views by an adapter that lives in its own repository
and depends on a tagged release of this one. Nothing in this repository knows
which system produced the rows.

Engine version: `2.0.0`. Contract version: `"2.0"`. A contract 1.0 input (the
`{name, split, runs}` shape) remains valid and is treated as a bundle with one
view named `default`.

## 1. Views bundle (input)

```json
{
  "contract": "2.0",
  "name": "free text",
  "split": "test | validation",
  "metadata": {
    "data_sha256": "64 hex", "recipe_sha256": "64 hex",
    "environment_sha256": "64 hex", "notes": "free text"
  },
  "views": {
    "<view name>": {
      "description": "free text",
      "runs": [
        {
          "id": "seed-0", "seed": 0,
          "metadata": { "model_sha256": "64 hex" },
          "rows": [
            { "sample_id": "doc12:span3", "cluster_id": "doc12",
              "y_true": 1, "y_pred": 1 }
          ]
        }
      ]
    }
  }
}
```

Rules, all enforced by `validate()`:

- `contract` must be `"2.0"` whenever `views` is present. An input without
  `views` and without `contract` (or with `contract: "1.0"`) is a v1 input.
- `split` is `test` or `validation`. A validation split is provisional.
- 1–50 views. Each view has 1–50 runs. Each run has a unique non-empty text
  `id` and a non-empty `rows` array.
- Every row has a unique non-empty text `sample_id` within its run, and
  `y_true` and `y_pred` as the numbers 0 or 1. 1 is the positive class.
- Within a view, every run has the identical set of `sample_id` with the
  identical `y_true`. Views are independent: different views may have
  different sample ids, row counts, and seeds.
- `cluster_id` is optional. If any row of a run has it, every row of that run
  must have it, and it must be a non-empty string.
- `seed` is optional but needed for stability (distinct seed count) and
  reproducibility (same-seed grouping). It must be an integer to count.
- Bundle-level `metadata` is optional. Its `data_sha256`, `recipe_sha256`, and
  `environment_sha256` are inherited by every run that does not set its own.
  `model_sha256` is always per run. Other keys such as `notes` are ignored by
  the judge.

### v1 input (still valid)

```json
{
  "name": "My experiment",
  "split": "test",
  "runs": [
    { "id": "seed-0", "seed": 0,
      "metadata": { "data_sha256": "…", "recipe_sha256": "…",
                    "environment_sha256": "…", "model_sha256": "…" },
      "rows": [ { "sample_id": "a", "y_true": 1, "y_pred": 1 } ] }
  ]
}
```

It is judged exactly as before: one view named `default`, Wilson intervals,
stability on accuracy, and the flat policy below.

## 2. Policy bundle (input)

```json
{
  "contract": "2.0",
  "confidence": true,
  "minRuns": 3,
  "views": {
    "<view name>": {
      "accuracy": null, "precision": null, "recall": 0.995, "fpr": null,
      "stabilityMetric": "recall", "maxSpread": 0.02,
      "selectedRun": "seed-0",
      "required": true
    }
  }
}
```

- `confidence` (boolean, bundle-level): when true, a gate also needs its 95%
  interval to clear the target. Default false.
- `minRuns` (integer 2–50, bundle-level): minimum number of runs and of
  distinct integer seeds for stability to be judged at all.
- Gate targets `accuracy`, `precision`, `recall` (minimums) and `fpr`
  (maximum) are numbers in [0, 1] or `null`. `null` (or absent) means the
  gate is not evaluated for that view and is reported with status `skipped`.
  At least one gate per view must be non-null.
- `stabilityMetric` is one of `accuracy | precision | recall | fpr`; default
  `accuracy`.
- `maxSpread` is a number in [0, 1]: the maximum allowed max−min spread of the
  stability metric across runs.
- `selectedRun` names the run whose metrics feed the performance gates. It
  should be prespecified from validation results. If absent or unknown, the
  first run is used.
- `required` (boolean, default true): a view with `required: false` is
  reported but does not feed the bundle verdict.
- A policy entry naming a view that is not in the bundle is an error.
- A view in the bundle with no policy entry is reported with all gates
  skipped and status `insufficient`. It counts as required. A missing policy
  is missing evidence, not a pass.

### v1 policy (still valid)

```json
{ "accuracy": 0.9, "precision": 0.9, "recall": 0.9, "fpr": 0.1,
  "confidence": true, "minRuns": 3, "maxSpread": 0.02, "selectedRun": "seed-0" }
```

A flat policy applies to the single `default` view. Gate values may be `null`
here too; `stabilityMetric` and `required` are accepted with the same defaults.

## 3. Decision rules

**Metrics.** For the selected run, `accuracy = (tp+tn)/n`,
`precision = tp/(tp+fp)`, `recall = tp/(tp+fn)`, `fpr = fp/(fp+tn)`. A zero
denominator gives value `null`. Point estimates are exact counts and never
depend on the interval method.

**Intervals.** Every metric carries `interval` (a `[low, high]` pair or
`null`) and `interval_method`:

- `wilson`: 95% two-sided Wilson score interval. Used when the run's rows
  have no `cluster_id`.
- `cluster_bootstrap`: used when the run's rows carry `cluster_id`. Clusters
  are resampled with replacement 1000 times; each resample's confusion counts
  are summed and the metric recomputed; the interval is the 2.5th–97.5th
  percentile of the resampled values (linear interpolation between order
  statistics). The pseudo-random generator is seeded with a 32-bit FNV-1a
  hash of the run `id`, so the interval is deterministic for a given input.
  Resamples with a zero denominator for a metric are dropped for that metric.

**Gate.** For a non-null target: value `null` → `insufficient`; value misses
the target (below a minimum, above the `fpr` maximum) → `fail`; otherwise,
with `confidence` on, interval crossing the target (lower bound below a
minimum, upper bound above the maximum) → `insufficient`; otherwise `pass`.
A `null` target → `skipped`.

**Performance** of a view: `fail` if any active gate fails; else
`insufficient` if any active gate is insufficient; else `pass`. A view with
no active gates is `insufficient`.

**Stability** of a view, on the chosen `stabilityMetric`:
`insufficient` if there are fewer than `minRuns` runs or distinct integer
seeds, if the stability metric's own target is `null`, or if any run has a
`null` value for it. Otherwise `fail` if max−min spread exceeds `maxSpread`
or any run's point value misses the target (above it for `fpr`, below it
otherwise). Otherwise `pass`. Stability is descriptive, not a guarantee.

**Reproducibility** of a view: runs are grouped by `(seed, data_sha256,
recipe_sha256, environment_sha256)` when all four, plus `model_sha256`, are
present as 64-hex strings (after inheriting bundle metadata). Groups with at
least two runs are comparable. No comparable group → `insufficient`; any
comparable group with differing `model_sha256` → `fail`; else `pass`.

**View overall**: `fail` if any axis fails; else `insufficient` if any axis
is insufficient; else `pass`.

**Bundle overall**: `fail` if any required view fails; else `insufficient` if
any required view is insufficient; else `pass`. A bundle with no required
view is `insufficient`.

## 4. Verdict (output)

```json
{
  "contract": "2.0",
  "engine_version": "2.0.0",
  "name": "free text",
  "split": "test",
  "overall": "pass | fail | insufficient",
  "views": {
    "<view name>": {
      "version": "1.0",
      "split": "test",
      "description": "free text",
      "selectedRun": "seed-0",
      "policy": { "…the normalised view policy, plus confidence and minRuns…" },
      "gates": [
        { "key": "recall", "value": 0.98, "interval": [0.953, 1],
          "interval_method": "cluster_bootstrap", "n": 150, "k": 147,
          "target": 0.95, "direction": "min", "status": "pass" }
      ],
      "performance": "pass", "stability": "pass", "stabilityMetric": "accuracy",
      "reproducibility": "pass", "overall": "pass",
      "runs": [ { "id": "seed-0", "seed": 0, "metrics": { "…" } } ],
      "confusion": { "accuracy": {}, "precision": {}, "recall": {}, "fpr": {},
                     "tp": 0, "tn": 0, "fp": 0, "fn": 0, "n": 0, "clusters": 30 },
      "mean": 0.98, "spread": 0.0067, "distinctSeeds": 3,
      "agreement": 0.99, "comparableGroups": 1,
      "notes": [ "…" ]
    }
  },
  "requiredViews": ["span", "document"],
  "policy": { "…the normalised policy bundle…" },
  "policy_sha256": "64 hex or null",
  "input_sha256": "64 hex or null",
  "notes": [
    "…",
    "Views are judged independently; the bundle verdict is the worst required view."
  ]
}
```

Each view result has the contract 1.0 per-run shape (`version: "1.0"`), with
`stabilityMetric`, `description`, `interval_method` on every metric, and
`clusters` (cluster count or `null`) added. `policy` is `null` for a view
that had no policy entry. `spread` and `mean` are of the stability metric and
are `null` when any run's value is undefined.

The v1 entry point `evaluate(input, policy)` returns the `default` view's
result with `policy` echoed exactly as passed; every field a 1.0 verdict had
is unchanged.

## 5. Hashes

`input_sha256` and `policy_sha256` are SHA-256 hex digests of the canonical
JSON of the input and policy as supplied by the caller. Canonical JSON sorts
object keys at every depth, drops `undefined` members, and has no whitespace
(`canonical()` in `engine.js`). The engine does no hashing itself: the CLI
uses `node:crypto` and the browser uses Web Crypto, and both pass the digests
in. A verdict produced without hashes carries `null`.

## 6. Command line

```
node dist/run-evidence.mjs <bundle.json> <policy.json> [--out verdict.json] [--quiet]
```

Prints a one-screen table (view, n, active gates with value and interval,
the three axes and the view verdict, then the bundle verdict) unless
`--quiet`. Writes the full verdict JSON with `--out`. Exit code: 0 pass,
1 fail, 2 insufficient, 3 input error (unreadable file, invalid JSON, or a
contract violation; the reason is printed to stderr).

Committed examples in `dist/examples/`:

| Command | Exit |
| --- | --- |
| `node dist/run-evidence.mjs dist/examples/bundle-v2.json dist/examples/policy-v2.json` | 0 (pass) |
| `node dist/run-evidence.mjs dist/examples/predictions-v1.json dist/examples/policy-v1.json` | 2 (insufficient: no reproducibility hashes) |

The v2 example is synthetic: two views, four runs each (three seeds and a
same-seed repeat), bundle-level data/recipe/environment hashes inherited by
every run, per-run model hashes, `cluster_id` on the first view only, and a
policy that skips two gates and judges stability on recall in the second view.
The hashes are placeholders that illustrate inheritance, not real fingerprints.

## 7. Statistical caveats

- Wilson intervals are 95% two-sided per metric and assume independent,
  representative observations. They are not simultaneous coverage across
  metrics or runs and not sequentially valid stopping certificates.
- Cluster-bootstrap intervals assume clusters are independent and
  representative. They are approximate, per metric, and unreliable when there
  are very few clusters: with one cluster the interval collapses to the point
  value. They widen relative to Wilson when errors concentrate in a few
  clusters, and are similar when errors are spread evenly.
- A confidence interval addresses sampling uncertainty, not distribution
  shift, label errors, leakage, or biased sampling.
- Stability across seeds is descriptive. Pairwise prediction agreement is
  reported separately and does not imply correctness.
- Reproducibility compares submitted hashes. They are not independently
  verified, and byte-level serialization can itself introduce differences.
- Passing overall accuracy can hide minority-class errors; gate on the
  metrics that matter and skip the ones that do not.
- Final-test results must not be used repeatedly to tune the model, the
  thresholds, or the policy. Obtain fresh evaluation data after tuning.
- Data split, independence, label correctness, and provenance are supplied by
  the submitter. A pass applies to these data and this policy; it is evidence,
  not a guarantee, and not a certification for safety-critical or financial use.
