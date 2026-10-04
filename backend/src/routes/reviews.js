import express from "express";
import { config } from "../config.js";
import { asyncRoute, authenticate, HttpError } from "../http.js";
import { claimTask, releaseTask, reviewerEarnings, reviewerProfile, submitTask, tasksForReviewer } from "../reviews.js";

/** Pages for native-speaker reviewers (accounts an admin marked as reviewers in Admin → Users). */
const router = express.Router();

async function reviewer(request) {
  if (!config.featureHumanReview) throw new HttpError(403, "Human review is currently turned off.");
  const profile = await reviewerProfile(request.userId);
  if (!profile) throw new HttpError(403, "This account isn't a ReelLingo reviewer. Contact support to apply.");
  return profile;
}

function action(handler) {
  return asyncRoute(async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(error.status || 400, error.message);
    }
  });
}

router.get("/reviews", authenticate, action(async (request, response) => {
  const profile = await reviewer(request);
  response.json({ reviewer: profile, ...(await tasksForReviewer(profile)), earnings: await reviewerEarnings(profile.user_id) });
}));

router.post("/reviews/:taskId/claim", authenticate, action(async (request, response) => {
  response.json(await claimTask(Number(request.params.taskId), await reviewer(request)));
}));

router.post("/reviews/:taskId/release", authenticate, action(async (request, response) => {
  await releaseTask(Number(request.params.taskId), await reviewer(request));
  response.json({ released: true });
}));

router.post("/reviews/:taskId/submit", authenticate, action(async (request, response) => {
  response.json(await submitTask(Number(request.params.taskId), await reviewer(request), request.body?.notes));
}));

export default router;
