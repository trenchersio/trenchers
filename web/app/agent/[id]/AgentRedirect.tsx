"use client";
import { useEffect } from "react";

export function AgentRedirect({ id }: { id: number }) {
  useEffect(() => { window.location.replace(`/collection#${id}`); }, [id]);
  return <main style={{ padding: 48, textAlign: "center" }}><a href={`/collection#${id}`}>Open Trencher #{id}</a></main>;
}
