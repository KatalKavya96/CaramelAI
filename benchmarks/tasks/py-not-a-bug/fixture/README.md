# listclean

Cleans newsletter subscriber lists before a send.

```sh
python3 -m listclean dedupe subscribers.txt > clean.txt
python3 -m listclean dedupe --fold-case subscribers.txt > clean.txt
```

Reads one address per line and writes each subscriber once, keeping the first spelling seen.
How duplicates are detected, and why, is in [docs/duplicates.md](docs/duplicates.md).
