import express from "express";
import { applyReferral, ensureProfile, updateProfile } from "../accounts.js";
import { login, logout, refreshSession, signup } from "../auth.js";
import { config } from "../config.js";
import { asyncRoute, authLimiter, signupLimiter } from "../http.js";

const router = express.Router();
const oauthProviders = new Set(["google", "github", "apple", "facebook"]);

router.post("/auth/signup", authLimiter, signupLimiter, asyncRoute(async (request, response) => {
  if (!config.signupsEnabled) {
    response.status(403).json({ detail: "New sign-ups are paused right now. Please check back soon.", code: "signups_closed" });
    return;
  }
  const { email, password, name, creator_type: creatorType, referral_code: referralCode } = request.body || {};
  if (!email || !password || String(password).length < 8) {
    response.status(400).json({ detail: "Enter an email and a password of at least 8 characters." });
    return;
  }
  let session;
  try {
    session = await signup(String(email).trim(), String(password));
  } catch (error) {
    response.status(400).json({ detail: error.message });
    return;
  }
  await ensureProfile(session.user_id, String(email).trim().toLowerCase());
  await updateProfile(session.user_id, {
    name: name ? String(name).trim().slice(0, 80) : undefined,
    creator_type: creatorType ? String(creatorType).slice(0, 60) : undefined,
  });
  if (referralCode) await applyReferral(session.user_id, referralCode);
  response.status(201).json(session);
}));

router.post("/auth/login", authLimiter, asyncRoute(async (request, response) => {
  const { email, password } = request.body || {};
  if (!email || !password) {
    response.status(400).json({ detail: "Email and password are required." });
    return;
  }
  try {
    const session = await login(String(email).trim(), String(password));
    await ensureProfile(session.user_id, session.email || String(email).trim().toLowerCase());
    response.json(session);
  } catch (error) {
    response.status(401).json({ detail: error.message });
  }
}));

router.post("/auth/refresh", authLimiter, asyncRoute(async (request, response) => {
  try {
    response.json(await refreshSession(request.body?.refresh_token));
  } catch (error) {
    response.status(401).json({ detail: error.message });
  }
}));

router.get("/auth/oauth/:provider", (request, response) => {
  const provider = String(request.params.provider);
  if (!oauthProviders.has(provider)) {
    response.status(404).json({ detail: "Unsupported sign-in provider." });
    return;
  }
  if (!config.supabaseUrl || !config.supabaseKey) {
    response.redirect(`${config.frontendUrl}/login?error=oauth_unavailable`);
    return;
  }
  const authorize = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
  authorize.searchParams.set("provider", provider);
  // ?app=admin sends the person back to the admin website instead of the studio.
  const returnTo = request.query.app === "admin" ? config.adminUrl : config.frontendUrl;
  authorize.searchParams.set("redirect_to", `${returnTo}/auth/callback`);
  response.redirect(authorize.toString());
});

router.post("/auth/logout", asyncRoute(async (request, response) => {
  await logout(request.headers.authorization);
  response.status(204).end();
}));

export default router;
