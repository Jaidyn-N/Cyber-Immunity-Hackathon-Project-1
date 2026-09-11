"use client";

import { useAuthCallback } from "@tidecloak/nextjs";
import { useEffect, useState } from "react";

function RedirectHandler() {
  const { isProcessing, isSuccess, error } = useAuthCallback({
    onSuccess: (returnUrl) => window.location.assign(returnUrl || "/"),
    onError: () => window.location.assign("/"),
    onMissingVerifierRedirectTo: "/",
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code") && !params.has("error")) window.location.assign("/");
  }, []);

  if (error) return <p>Authentication failed: {error.message}</p>;
  if (isProcessing || !isSuccess) return <p>Completing login…</p>;
  return <p>Redirecting…</p>;
}

export default function AuthRedirectPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <RedirectHandler /> : <p>Loading…</p>;
}
