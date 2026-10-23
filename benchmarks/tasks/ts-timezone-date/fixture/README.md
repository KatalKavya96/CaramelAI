# duebot

Writes the reminder line for each task due soon.

```sh
bun run src/cli.ts tasks.json
# Reminder: "File VAT return" is due Mon 3 Mar
```

Due dates are calendar dates (`"2025-03-03"`), with no time of day: a task due on 3 March is
due on 3 March wherever the person reading the email lives. The server sending the emails runs
in UTC; our team and users are spread from California to New Zealand.
