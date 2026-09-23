import { Composition } from "remotion";
import { Demo, TOTAL } from "./Demo";

export function Root() {
  return <Composition id="Demo" component={Demo} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />;
}
