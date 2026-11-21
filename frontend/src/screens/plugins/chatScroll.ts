import { useEffect, useLayoutEffect, useRef } from "react";

type Box = { scrollHeight: number; scrollTop: number; clientHeight: number };

/** The scroll position that puts a turn at the box's top edge, clamped to what the box can reach. */
export function pinnedTop(box: Pick<Box, "scrollHeight" | "clientHeight">, turnTop: number) {
  return Math.max(0, Math.min(turnTop, box.scrollHeight - box.clientHeight));
}

/** The empty space below a short last turn that lets its question reach the top edge. */
export function tailroom(box: Pick<Box, "clientHeight">, turnHeight: number) {
  return Math.max(0, box.clientHeight - turnHeight);
}

/** Whether the reader stands at the bottom. A growing line moves the bottom by
 * a few pixels before the next event, so anything closer than 24 px counts;
 * one line of distance (24 px and more) already means the reader went up to
 * read. */

export function standsAtTheBottom(box: Box): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight < 24;
}

/** How far a transform currently moves an element down; 0 where none can be read. */
function shiftOf(el: Element): number {
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === "none" || typeof DOMMatrixReadOnly !== "function") return 0;
  try {
    return new DOMMatrixReadOnly(transform).m42;
  } catch {
    return 0;
  }
}

/** What the hook remembers about the reader between renders and layout changes. */
type View = { atBottom: boolean; readerMoved: boolean; pinnedAt: number };

/** Sets the room below the last turn and scrolls the box to the pin, or to the
 * bottom under `follow`. Leaves the box alone once the reader took it. */

function aim(
  box: HTMLDivElement,
  room: HTMLDivElement | null,
  follow: boolean,
  switched: boolean,
  view: View,
) {
  const lastTurn = box.querySelector<HTMLElement>("article:last-of-type");
  // The room is set on the element itself, before the pin aims: a room
  // kept as state would reach the DOM a render later, and the pin would
  // aim at a box that cannot yet scroll that far.
  const setRoom = (px: number) => {
    if (room) room.style.height = `${px}px`;
  };
  if (follow) {
    setRoom(0);
    if (switched || view.atBottom) box.scrollTop = box.scrollHeight;
    return;
  }
  if (view.readerMoved) return;
  if (!lastTurn) {
    setRoom(0);
    return;
  }
  setRoom(tailroom(box, lastTurn.getBoundingClientRect().height));
  // A new turn rises into place: its box is drawn shifted by the entrance
  // transform, and aiming at that position would leave the question cut
  // off once the motion ends. The pin aims at where the turn comes to rest.
  const top =
    lastTurn.getBoundingClientRect().top -
    box.getBoundingClientRect().top +
    box.scrollTop -
    shiftOf(lastTurn);
  const target = pinnedTop(box, top);
  if (box.scrollTop === target) return;
  box.scrollTop = target;
  // Remembered as the browser took it: a fractional target is rounded to the
  // device's pixels, and the scroll event then reports the rounded position —
  // compared with the target it would read as the reader taking the box.
  view.pinnedAt = box.scrollTop;
}

/** How the conversation box scrolls while an answer grows. */

export function useConversationScroll({
  conversation,
  turns,
  content,
  follow = false,
}: {
  /** Changes when another conversation is shown. */
  conversation: string;
  /** How many turns the conversation has; one more is a new question. */
  turns: number;
  /** Changes whenever a turn grows: a step, a piece of the answer, a new turn. */
  content: string;
  follow?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const roomRef = useRef<HTMLDivElement | null>(null);
  const view = useRef<View>({ atBottom: true, readerMoved: false, pinnedAt: -1 });
  const shown = useRef(conversation);
  const counted = useRef(turns);

  const repin = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const switched = shown.current !== conversation;
    shown.current = conversation;
    const asked = turns > counted.current;
    counted.current = turns;
    if (switched || asked) {
      view.current.atBottom = true;
      view.current.readerMoved = false;
    }
    repin.current = () => aim(box, roomRef.current, follow, false, view.current);
    aim(box, roomRef.current, follow, switched, view.current);
  }, [conversation, turns, content, follow]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const again = () => repin.current();
    box.addEventListener("animationend", again);
    let sizes: ResizeObserver | undefined;
    if (typeof ResizeObserver === "function") {
      sizes = new ResizeObserver(again);
      box.querySelectorAll("article").forEach((turn) => sizes?.observe(turn));
    }
    return () => {
      box.removeEventListener("animationend", again);
      sizes?.disconnect();
    };
  }, [conversation, turns]);

  const onScroll = () => {
    const box = boxRef.current;
    if (!box) return;
    view.current.atBottom = standsAtTheBottom(box);
    if (box.scrollTop === view.current.pinnedAt) return;
    view.current.readerMoved = true;
  };

  return { boxRef, roomRef, onScroll };
}
