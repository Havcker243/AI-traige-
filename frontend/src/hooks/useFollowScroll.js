import { useEffect, useRef, useState } from 'react';

export function useFollowScroll(key, revision) {
  const scrollRef = useRef(null);
  const following = useRef(true);
  const [paused, setPaused] = useState(false);
  const jumpToLatest = () => {
    following.current = true;
    setPaused(false);
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  };
  useEffect(() => {
    following.current = true;
    setPaused(false);
  }, [key]);
  useEffect(() => {
    const box = scrollRef.current;
    if (box && following.current) box.scrollTop = box.scrollHeight;
  }, [key, revision]);
  const onScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
    setPaused(!following.current);
  };
  return { scrollRef, onScroll, paused, jumpToLatest };
}
