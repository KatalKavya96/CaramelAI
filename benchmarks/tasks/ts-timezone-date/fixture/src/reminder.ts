import { formatDueDate } from "./dates";

export interface Task {
  title: string;
  due: string;
}

export function reminderLine(task: Task): string {
  return `Reminder: "${task.title}" is due ${formatDueDate(task.due)}`;
}
