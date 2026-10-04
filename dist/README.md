# Model Evidence

## Factory maintenance experiment

The main page now runs a complete, employer-independent synthetic factory experiment. It simulates 100 machines over 480 hours, then trains logistic classifiers to predict failures within 24 hours using noisy sensor histories. There is no real company data or proprietary product logic.

The generator and learner are in `factory-core.js`; `factory-worker.js` runs training in a browser worker. The experiment fits models using 4, 12, 30 and 60 machines, selects a training size/checkpoint/threshold using separate validation machines, then evaluates on 20 unseen machines at later times. It repeats training under three seeds and compares an exact same-seed rerun. Data splits leave gaps for the 24-hour outcome horizon.

Acceptance uses recall, precision, false-positive rate, and optional 95% machine-cluster bootstrap intervals. Whole-machine resampling preserves within-machine temporal dependence. The intervals are approximate, per-metric, not simultaneous or sequential guarantees. A fixed policy and fresh final evaluation are needed outside exploratory use. Stability requires all three distinct-seed runs to clear the policy and a recall spread <=5 percentage points. Exact reproducibility compares model weights, scaling, threshold, and test predictions within one runtime.

The failure-event warning count includes only events with at least one at-risk reading in the test window. A failure with one warning is counted as warned; this does not impose a minimum intervention lead time. False alerts and missed at-risk observations are hourly checks, not distinct visits or outages. Model scores are not calibrated probabilities.

Every result is specific to this deliberately simplified simulator. It demonstrates training and acceptance behavior, not real machinery reliability. The `noise` scenario includes unforeseeable sudden faults; `shift` changes conditions only after validation. Neither additional data nor epochs guarantees a target can be achieved.

To run outside the browser, download `factory-core.js` and `run-factory.mjs` into the same directory and use a current Node.js runtime:

    node run-factory.mjs wear 2026 factory-experiment.json

## Generic classification evaluator

The original interface remains available at `/evaluator.html` with the features below.

A working binary-classification acceptance evaluator. Runs entirely in the browser, with no prediction upload to a server. Import JSON; set minimum accuracy, precision and recall, maximum false-positive rate, minimum distinct training seeds, and maximum accuracy spread. Export the assessment as JSON.

## Run training

Install numpy and scikit-learn in your Python environment, then run:

    python train_example.py --output predictions.json --target 0.90

Or supply a numeric CSV with a header, numeric features, and a final binary label column:

    python train_example.py --csv data.csv --output predictions.json

This trains SGD classifiers with three seeds plus an identical-seed repeat, records each epoch, stops when the validation accuracy's lower 95% Wilson bound clears the target, or when progress stalls, or when the epoch budget expires. The best validation checkpoint is selected. Test predictions are made only after all models are frozen. The adapter is an executable integration example, not a general model-training platform. It uses a random stratified split suitable only for independent observations. Use time-aware/group-aware splits for financial, repeated-patient, or other correlated data.

## JSON contract

The authoritative schema is `CONTRACT.md` (contract 2.0): views, optional gates, a per-view stability metric, cluster-bootstrap intervals, inherited hashes, the verdict shape, and the command line `node run-evidence.mjs <bundle.json> <policy.json>` with exit codes 0 pass, 1 fail, 2 insufficient, 3 input error. The contract 1.0 shape below remains valid and is judged as a single view named `default`.

    {
      "name": "My experiment",
      "split": "test",
      "runs": [{
        "id": "seed-0",
        "seed": 0,
        "rows": [{"sample_id": "a", "y_true": 1, "y_pred": 1}]
      }]
    }

All runs must cover the identical sample IDs and ground-truth labels. Labels must be numeric 0/1. Maximum 50 runs and 10 MB through the browser import. A validation split is explicitly provisional. The selected run should be prespecified using validation, not chosen by inspecting test results.

## Decision rules

Performance uses the selected run. A point estimate missing its target is FAIL. A point estimate meeting its target but its Wilson interval crossing the target is INSUFFICIENT EVIDENCE when interval enforcement is enabled. Undefined denominators are insufficient evidence. Otherwise the gate passes. Overall performance passes only when every performance gate passes.

Stability requires enough distinct integer seeds, every run's point value of the stability metric (accuracy unless the policy says otherwise) meeting that metric's target, and a max-minus-min spread within the configured limit. Gates whose target is null are skipped; a view needs at least one active gate. It is descriptive, not a confidence guarantee about future retraining. Pairwise prediction agreement is computed using matched sample IDs and is reported separately. Three seeds are an illustrative starting point, not proof of robust training.

Reproducibility requires at least one group of repeated runs with the same seed and matching data_sha256, recipe_sha256, environment_sha256 in metadata. All model_sha256 values within every comparable group must match. Hashes are supplied evidence, not independently verified. Exact byte-level model serialization can itself introduce differences; the adapter hashes deterministic inference parameters and preprocessing state. Its environment fingerprint includes versions/platform but is not a complete dependency/BLAS/hardware attestation.

The overall verdict combines all three axes: any failure fails; otherwise any unknown means insufficient evidence; all passing gives pass. All demo data are synthetic and deliberately lack reproduction hashes. Thus good demo classification scores do not automatically yield an overall pass.

## Statistical boundaries

- Wilson intervals are 95% two-sided per metric and assume independent representative observations. They are not simultaneous coverage across all metrics/runs and not sequentially valid stopping certificates.
- Rows that carry a `cluster_id` are judged with a 95% cluster-bootstrap percentile interval (1000 whole-cluster resamples, seeded by run id). It respects within-cluster dependence but assumes independent clusters and is unreliable with very few clusters.
- The adapter's repeated validation checks guide stopping only. Final acceptance requires the untouched test set. Never repeatedly tune on that test set; obtain fresh evaluation data after model or policy tuning.
- A confidence interval addresses sampling uncertainty, not distribution shift, label errors, leakage, or biased sampling.
- Passing overall accuracy can hide minority-class errors. Use appropriate task-specific gates. This version is binary only and does not provide subgroup checks, calibrated probability decisions, multiclass evaluation, or deployment monitoring.
- Data quality, independence, label correctness, and split provenance are not automatically verified.
- This is not certification for medical decision making or evidence of profitable trading.
- No automatic deployment, live GPU job orchestration, or training-cost estimation is included in v1.

## Implementation

The evaluation engine is framework-independent JavaScript in engine.js; it is a pure function of input and policy with no I/O. `run-evidence.mjs` is the command line. The interface is static HTML/CSS/JS. There are no runtime JavaScript dependencies. The Python training adapter uses scikit-learn. Unit tests cover the statistical decisions and failure cases. Source is preserved with this Site.
