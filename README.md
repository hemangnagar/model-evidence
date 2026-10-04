# Model Evidence

**Has a classifier met the required performance—and does retraining produce consistent results?**

Model Evidence makes that question concrete with a synthetic factory maintenance experiment and a general binary-classification evaluator.

## Try the application

- [Factory maintenance experiment](https://model-evidence.hemnag.chatgpt.site)
- [Evaluate your own model](https://model-evidence.hemnag.chatgpt.site/evaluator.html)

The hosted application currently has owner-private access. Clone this repository and run it locally to use it without access to that deployment.

## Factory experiment

Predict whether a machine will fail in the next 24 hours using synthetic vibration, temperature, current, load, service age, and recent sensor changes.

The experiment:

1. Simulates 100 machines over 480 hours, with hidden wear, failures, repairs, and noisy measurements.
2. Trains logistic classifiers using 4, 12, 30, and 60 machines.
3. Uses 20 different machines at later times to select a training size, model checkpoint, and warning threshold.
4. Evaluates the frozen models on another 20 unseen machines at still later times.
5. Repeats training with three seeds and an exact same-seed rerun.

Choose gradual wear, noisy sensors with sudden faults, or changed conditions after training. Set recall, precision, and false-warning limits, optionally requiring the approximate 95% confidence bounds to meet them.

Results show the learning curve, stopping reason, missed at-risk checks, false warnings, failure events with at least one warning, training variation, and exact reproducibility. Training executes in a browser worker; it is not a prerecorded animation or a hosted model API call.

## Generic evaluator

Import predictions from an already-trained binary classifier as JSON. Set accuracy, precision, recall, false-positive-rate, confidence-interval, seed-count, and accuracy-spread requirements. The page includes a guide explaining every criterion and the resulting verdicts.

Classification, stability, and reproducibility are separate assessments. A high accuracy score alone does not establish all three. The overall result is **Pass**, **Fail**, or **Insufficient evidence**.

## Views and adapters

The judge is task-blind. Systems under test are judged through an adapter that reduces them to views: named sets of binary rows, each judged on its own axes and targets, with the bundle verdict being the worst required view. Adapters live in their own repositories and depend on a tagged release of this one; this repository never imports, names, or special-cases a system under test. Contract 2.0 adds views, optional (`null`) gates, a per-view stability metric, `cluster_id` rows judged with a cluster-bootstrap interval, inherited bundle-level hashes, and SHA-256 fingerprints of the input and policy in the verdict. Contract 1.0 inputs remain valid and are judged unchanged. The schema and decision rules are in [dist/CONTRACT.md](dist/CONTRACT.md).

## Command line

```bash
node dist/run-evidence.mjs <bundle.json> <policy.json> [--out verdict.json] [--quiet]
node dist/run-evidence.mjs dist/examples/bundle-v2.json dist/examples/policy-v2.json      # exit 0, pass
node dist/run-evidence.mjs dist/examples/predictions-v1.json dist/examples/policy-v1.json  # exit 2, insufficient
```

The CLI prints a one-screen table of each view's active gates and verdicts, writes the full verdict JSON with `--out`, and exits 0 for pass, 1 for fail, 2 for insufficient evidence, and 3 for an input error, so CI can gate on it. It uses Node built-ins only.

## Run locally

The web interface has no JavaScript package dependencies or build step. Use Python 3 to serve the static files:

```bash
git clone https://github.com/hemangnagar/model-evidence.git
cd model-evidence
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000` for the factory experiment or `http://localhost:8000/evaluator.html` for the generic evaluator. Serve over HTTP rather than opening the HTML file directly: browser modules and workers require a suitable origin. Fonts load from Google Fonts, with system-font fallbacks; prediction data stays in the browser.

## Run tests and the factory experiment from the command line

Use Node.js 22 or newer; no npm installation is required.

```bash
npm test
node dist/run-factory.mjs wear 2026 factory-experiment.json
node dist/run-factory.mjs noise 2026 noisy-experiment.json
node dist/run-factory.mjs shift 2026 shifted-experiment.json
```

The test suite contains 30 checks covering data separation, future-event labels, reproducibility, acceptance decisions, confidence intervals, malformed inputs, contract 2.0 bundles, cluster-bootstrap intervals, and CLI exit codes. The 15 original checks are unchanged, and a fixture pins the v1 verdict fields byte for byte.

## Optional Python training adapter

This separate example trains a classifier on generic synthetic data or your numeric CSV and exports predictions for the generic evaluator. It requires NumPy and scikit-learn:

```bash
python -m pip install numpy scikit-learn
python dist/train_example.py --output predictions.json --target 0.90
python dist/train_example.py --csv data.csv --output predictions.json
```

CSV input needs a header, finite numeric feature columns, and a final binary label column containing 0 and 1. The adapter uses random stratified splits, so correlated subjects or time-series data require a different split strategy.

## Project structure

| Path | Purpose |
| --- | --- |
| `dist/index.html`, `factory-app.js`, `factory.css` | Factory experiment interface |
| `dist/factory-core.js` | Simulation, training, model selection, and evaluation |
| `dist/factory-worker.js` | Browser worker for actual training |
| `dist/run-factory.mjs` | Factory command-line runner |
| `dist/evaluator.html`, `app.js`, `style.css` | Generic evaluator and explanatory guide |
| `dist/engine.js` | Generic acceptance engine: views, gates, intervals, verdicts (pure, no I/O) |
| `dist/run-evidence.mjs` | Acceptance command line with CI exit codes |
| `dist/CONTRACT.md` | Contract 2.0: input, policy, and verdict schema with decision rules |
| `dist/examples/` | Committed v1 and v2 example inputs and policies |
| `dist/train_example.py` | Optional scikit-learn training adapter |
| `dist/trained-example*.json` | Actual adapter outputs from synthetic data |
| `dist/README.md` | Detailed evaluation methods and limitations |
| `tests/` | Node.js test suites |

`dist/` contains authored static source, not disposable build output. Keep it under version control. Deployment-specific identity and credentials are not required for local use and are not included in this repository. Updating GitHub does not automatically update the private hosted site.

## What this proves—and what it does not

The factory data is entirely synthetic and independent of any employer product. Good results establish performance against this simplified simulator, not real-world machinery reliability or suitability for automated safety decisions.

- The factory uses whole-machine bootstrap intervals to preserve within-machine dependence. They are approximate, per-metric intervals based on only 20 held-out machines.
- The generic evaluator uses Wilson intervals that assume independent representative examples, or a cluster bootstrap when rows carry a `cluster_id`, which still assumes independent clusters.
- Repeated validation checks guide model selection and stopping; they are not sequential statistical guarantees. Repeatedly tuning after inspecting final-test results requires fresh test data before making a real acceptance claim.
- False warnings and missed at-risk observations are hourly checks, not unique service visits. The event-level count is reported separately.
- Exact reproducibility in the factory applies to the same runtime and configuration. The generic evaluator compares submitted hashes rather than independently rerunning training.
- More data or more epochs cannot guarantee an arbitrary target. This project does not estimate GPU training cost or orchestrate production training jobs.

See [the detailed methodology](dist/README.md) and [the contract](dist/CONTRACT.md) for the JSON input schema and decision rules.
