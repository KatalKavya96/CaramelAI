export interface RunningDockerProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

export interface DockerBackend {
  run(args: readonly string[]): RunningDockerProcess;
  removeForce(containerName: string): Promise<void>;
  /** False when the daemon is unreachable or the image is not built. */
  imageAvailable(image: string): Promise<boolean>;
}

export class DockerCliBackend implements DockerBackend {
  run(args: readonly string[]): RunningDockerProcess {
    const process = Bun.spawn(["docker", ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      stdout: process.stdout,
      stderr: process.stderr,
      exited: process.exited,
      kill: () => process.kill(),
    };
  }

  async imageAvailable(image: string): Promise<boolean> {
    try {
      const process = Bun.spawn(["docker", "image", "inspect", image], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      const timeout = setTimeout(() => process.kill(), 10_000);
      try {
        return (await process.exited) === 0;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // The docker binary itself is missing.
      return false;
    }
  }

  async removeForce(containerName: string): Promise<void> {
    const process = Bun.spawn(["docker", "rm", "--force", "--volumes", containerName], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    const timeout = setTimeout(() => process.kill(), 5_000);
    try {
      await process.exited;
    } finally {
      clearTimeout(timeout);
    }
  }
}
