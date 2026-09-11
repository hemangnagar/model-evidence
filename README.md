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

The test suite contains 15 checks covering data separation, future-event labels, reproducibility, acceptance decisions, confidence intervals, and malformed inputs.

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
| `dist/engine.js` | Generic classification acceptance engine |
| `dist/train_example.py` | Optional scikit-learn training adapter |
| `dist/trained-example*.json` | Actual adapter outputs from synthetic data |
| `dist/README.md` | Detailed evaluation methods and limitations |
| `tests/` | Node.js test suites |

`dist/` contains authored static source, not disposable build output. Keep it under version control. Deployment-specific identity and credentials are not required for local use and are not included in this repository. Updating GitHub does not automatically update the private hosted site.

## What this proves—and what it does not

The factory data is entirely synthetic and independent of any employer product. Good results establish performance against this simplified simulator, not real-world machinery reliability or suitability for automated safety decisions.

- The factory uses whole-machine bootstrap intervals to preserve within-machine dependence. They are approximate, per-metric intervals based on only 20 held-out machines.
- The generic evaluator uses Wilson intervals that assume independent representative examples.
- Repeated validation checks guide model selection and stopping; they are not sequential statistical guarantees. Repeatedly tuning after inspecting final-test results requires fresh test data before making a real acceptance claim.
- False warnings and missed at-risk observations are hourly checks, not unique service visits. The event-level count is reported separately.
- Exact reproducibility in the factory applies to the same runtime and configuration. The generic evaluator compares submitted hashes rather than independently rerunning training.
- More data or more epochs cannot guarantee an arbitrary target. This project does not estimate GPU training cost or orchestrate production training jobs.

See [the detailed methodology](dist/README.md) for the JSON input contract and decision rules.
