import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AmbientGradient } from "../src/experience/AmbientGradient";

const putImageData = vi.fn();
const requestFrame = vi.fn((_callback: FrameRequestCallback) => 42);
const cancelFrame = vi.fn();
let intersect: (entries: { isIntersecting: boolean }[]) => void;
let mediaChange: () => void;
const disconnect = vi.fn();
let systemReduced = false;

beforeEach(() => {
  vi.clearAllMocks();
  systemReduced = false;
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (width:number,height:number) => ({ data:new Uint8ClampedArray(width * height * 4) }),
    putImageData,
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return systemReduced; },
    addEventListener: (_:string, listener:()=>void) => { mediaChange = listener; },
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback:typeof intersect) { intersect = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("draws a static field when the visitor requests less motion", () => {
  render(<AmbientGradient theme="light" reducedMotion className="mesh" />);
  expect(putImageData).toHaveBeenCalledOnce();
  expect(requestFrame).not.toHaveBeenCalled();
});

it("stops offscreen, resumes on screen, and responds to system motion preferences", () => {
  const { unmount } = render(<AmbientGradient theme="dark" reducedMotion={false} className="mesh" />);
  expect(requestFrame).toHaveBeenCalledOnce();
  act(() => intersect([{ isIntersecting:false }]));
  expect(cancelFrame).toHaveBeenLastCalledWith(42);
  expect(requestFrame).toHaveBeenCalledOnce();
  act(() => intersect([{ isIntersecting:true }]));
  expect(requestFrame).toHaveBeenCalledTimes(2);
  systemReduced = true;
  act(() => mediaChange());
  expect(cancelFrame).toHaveBeenLastCalledWith(42);
  expect(requestFrame).toHaveBeenCalledTimes(2);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("repaints the field with the selected theme", () => {
  const { rerender } = render(<AmbientGradient theme="light" reducedMotion className="mesh" />);
  const light = putImageData.mock.calls[0]![0].data[0];
  rerender(<AmbientGradient theme="dark" reducedMotion className="mesh" />);
  const dark = putImageData.mock.calls[1]![0].data[0];
  expect(light).toBeGreaterThan(200);
  expect(dark).toBeLessThan(80);
});

it.each(["light","dark"] as const)("visibly changes the %s field within six seconds", (theme) => {
  render(<AmbientGradient theme={theme} reducedMotion={false} className="mesh" />);
  const initial = new Uint8ClampedArray(putImageData.mock.calls[0]![0].data);
  const start = performance.now();
  for (let step = 1; step <= 120; step++) {
    const callback = requestFrame.mock.calls.at(-1)![0];
    act(() => callback(start + step * 50));
  }
  const current = putImageData.mock.calls.at(-1)![0].data as Uint8ClampedArray;
  let difference = 0;
  for (let i = 0; i < current.length; i++) {
    if (i % 4 !== 3) difference += Math.abs(current[i]! - initial[i]!);
  }
  expect(difference / (current.length * .75)).toBeGreaterThan(.5);
});

it("keeps real-time movement when the browser throttles animation frames", () => {
  render(<AmbientGradient theme="dark" reducedMotion={false} className="mesh" />);
  const initial = new Uint8ClampedArray(putImageData.mock.calls[0]![0].data);
  const callback = requestFrame.mock.calls.at(-1)![0];
  act(() => callback(performance.now() + 6000));
  const current = putImageData.mock.calls.at(-1)![0].data as Uint8ClampedArray;
  let difference = 0;
  for (let i = 0; i < current.length; i++) {
    if (i % 4 !== 3) difference += Math.abs(current[i]! - initial[i]!);
  }
  expect(difference / (current.length * .75)).toBeGreaterThan(3);
});
