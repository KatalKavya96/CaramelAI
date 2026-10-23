# How listclean decides two addresses are the same

An address has two parts: `local@domain`.

**The domain is always compared case-insensitively.** Domain names are case-insensitive
everywhere, so `bob@Example.COM` and `bob@example.com` are one subscriber.

**The local part is compared exactly, by default.** RFC 5321 lets a mail server treat
`Bob@example.com` and `bob@example.com` as different mailboxes, and some do (several
university and corporate servers in our customer base). Merging them silently could send
one person's newsletter, including their unsubscribe link, to someone else. We decided in
#88 that listclean must never do that unless the list owner asks.

**If you know your list only has providers that ignore case** (Gmail, Outlook, Fastmail and
most consumer mail do), pass `--fold-case` on the command line, or `fold_case=True` in Python,
and the local part is compared case-insensitively too.
