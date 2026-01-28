import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { spawn } = await import("child_process");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const child = spawn("docker", ["stats", "--format", "{{json .}}", "--no-trunc"]);

      let buffer = "";
      // Regex to strip ANSI escape codes (colors, cursor movements like \u001b[H, etc.)
      // eslint-disable-next-line no-control-regex
      const ansiRegex = /\x1b\[[0-9;]*[a-zA-Z]/g;

      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          // Clean the line of any terminal control characters
          const line = rawLine.replace(ansiRegex, "").trim();
          
          if (line) {
            // Handle potentially concatenated JSON objects
            const parts = line.replace(/}\s*{/g, "}\n{").split("\n");
            for (const part of parts) {
                if (part.trim()) {
                    controller.enqueue(encoder.encode(`data: ${part}\n\n`));
                }
            }
          }
        }
      });

      child.stderr.on("data", (data) => {
        console.error(`docker stats error: ${data}`);
      });

      child.on("close", () => {
        controller.close();
      });

      // Handle abort (client disconnect)
      req.signal.addEventListener("abort", () => {
        child.kill();
      });
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
