# Initialize director module

# Bumped whenever a stage starts depending on something new in this
# package. The notebook writes these files at runtime, so /kaggle/working
# can hold an older copy than the notebook expects — which surfaces as an
# ImportError deep in a later stage rather than as "re-run Stage 4".
PACKAGE_BUILD = 3
