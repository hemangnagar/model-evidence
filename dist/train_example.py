"""Runnable binary-classification training adapter. Requires numpy and scikit-learn.

python train_example.py --output predictions.json --target 0.90
Uses synthetic data by default; --csv accepts numeric features plus a label column.
The acceptance target is illustrative. See README.md for evaluation limitations.
"""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import numpy as np
import sklearn
from sklearn.datasets import make_classification
from sklearn.linear_model import SGDClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler


def digest(value):
    return hashlib.sha256(value).hexdigest()


def lower_bound(k, n):
    z = 1.959963984540054
    p = k / n
    return (p + z*z/(2*n) - z*np.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', help='Numeric CSV, last column is binary label 0/1, with header')
    parser.add_argument('--output', default='predictions.json')
    parser.add_argument('--target', type=float, default=.90)
    parser.add_argument('--max-epochs', type=int, default=100)
    parser.add_argument('--patience', type=int, default=12)
    args = parser.parse_args()
    if not 0 < args.target < 1 or args.max_epochs < 1 or args.patience < 1:
        parser.error('target must be in (0,1); epochs and patience must be positive')
    if args.csv:
        raw = np.genfromtxt(args.csv, delimiter=',', skip_header=1)
        if raw.ndim != 2 or raw.shape[1] < 2 or not np.isfinite(raw).all():
            parser.error('CSV must contain finite numeric feature columns and one final label column')
        X, y = raw[:, :-1], raw[:, -1]
        if set(np.unique(y)) != {0, 1}:
            parser.error('Labels must contain both 0 and 1')
        y = y.astype(int)
    else:
        X, y = make_classification(n_samples=5000, n_features=20, n_informative=12,
                                   class_sep=1.8, flip_y=.02, random_state=41)
    ids = np.arange(len(y))
    trainval, test = train_test_split(ids, test_size=.2, stratify=y, random_state=123)
    train, val = train_test_split(trainval, test_size=.25, stratify=y[trainval], random_state=124)
    scaler = StandardScaler().fit(X[train])
    Xt, Xv = scaler.transform(X[train]), scaler.transform(X[val])
    # Test features/labels are never used in epoch selection or stopping.
    data_hash = digest(X.tobytes()+y.tobytes()+train.tobytes()+val.tobytes()+test.tobytes())
    recipe_hash = digest(Path(__file__).read_bytes()+json.dumps({'target':args.target,'max_epochs':args.max_epochs,'patience':args.patience},sort_keys=True).encode())
    environment_hash = digest(json.dumps({'python':platform.python_version(),'platform':platform.platform(),
        'numpy':np.__version__,'sklearn':sklearn.__version__},sort_keys=True).encode())
    models, history = [], []
    for run_id, seed in [('seed-0',0),('seed-1',1),('seed-2',2),('seed-0-repeat',0)]:
        model = SGDClassifier(loss='log_loss', alpha=.001, learning_rate='constant', eta0=.01, random_state=seed)
        rng = np.random.default_rng(seed)
        best, stale, checkpoint, trace = -1, 0, None, []
        stop = 'budget_exhausted'
        for epoch in range(1, args.max_epochs+1):
            order = rng.permutation(len(train))
            model.partial_fit(Xt[order], y[train][order], classes=np.array([0,1]))
            correct = int(np.sum(model.predict(Xv)==y[val])); accuracy = correct/len(val)
            bound = lower_bound(correct,len(val))
            trace.append({'epoch':epoch,'validation_accuracy':accuracy,'lower_95_bound':bound})
            if accuracy > best:
                best, stale = accuracy, 0
                checkpoint = (model.coef_.copy(),model.intercept_.copy(),epoch)
            else:
                stale += 1
            if bound >= args.target:
                stop = 'validation_target_reached'; break
            if stale >= args.patience:
                stop = 'plateau_below_target'; break
        model.coef_, model.intercept_, chosen_epoch = checkpoint
        model_hash = digest(model.coef_.tobytes()+model.intercept_.tobytes()+scaler.mean_.tobytes()+scaler.scale_.tobytes()+model.classes_.tobytes())
        models.append((run_id,seed,model,model_hash))
        history.append({'id':run_id,'stop_reason':stop,'selected_epoch':chosen_epoch,'trace':trace})
        print(f'{run_id}: {stop}; selected epoch {chosen_epoch}; validation accuracy {best:.3f}')
    # Only after all models are frozen, evaluate the untouched test set.
    runs=[]
    for run_id,seed,model,model_hash in models:
        pred=model.predict(scaler.transform(X[test]))
        runs.append({'id':run_id,'seed':seed,'rows':[{'sample_id':str(int(i)),'y_true':int(y[i]),'y_pred':int(p)} for i,p in zip(test,pred)],
          'metadata':{'data_sha256':data_hash,'recipe_sha256':recipe_hash,'environment_sha256':environment_hash,'model_sha256':model_hash}})
    out=Path(args.output)
    out.write_text(json.dumps({'name':'SGD binary classification experiment','split':'test','runs':runs}))
    out.with_suffix('.history.json').write_text(json.dumps(history,indent=2))
    print(f'Wrote {out} and training history. Import predictions into Model Evidence.')
    print('The target applies to validation accuracy only; the app separately checks all acceptance gates.')


if __name__ == '__main__':
    main()
