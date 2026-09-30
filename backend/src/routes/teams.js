import express from "express";
import { planFor } from "../accounts.js";
import { asyncRoute, authenticate, HttpError, requireFeature } from "../http.js";
import { acceptInvite, createTeam, getMembership, getTeam, inviteMember, listMembers, listTeamsFor, removeMember, setMemberRole } from "../teams.js";

const router = express.Router();
router.use("/teams", requireFeature("featureTeams", "Team workspaces"));

async function membership(request) {
  const teamId = Number(request.params.teamId);
  const member = Number.isInteger(teamId) ? await getMembership(teamId, request.userId) : null;
  if (!member) throw new HttpError(404, "Team not found.");
  return member;
}

router.get("/teams", authenticate, asyncRoute(async (request, response) => {
  response.json(await listTeamsFor(request.user));
}));

router.post("/teams", authenticate, asyncRoute(async (request, response) => {
  const owned = (await listTeamsFor(request.user)).filter((team) => team.role === "owner");
  if (owned.length >= 5) throw new HttpError(400, "You can own up to 5 teams.");
  try {
    response.status(201).json(await createTeam(request.user, request.body?.name));
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}));

router.get("/teams/:teamId", authenticate, asyncRoute(async (request, response) => {
  const member = await membership(request);
  const team = await getTeam(member.teamId);
  const plan = await planFor({ userId: request.userId, teamId: member.teamId });
  response.json({ ...team, role: member.role, members: await listMembers(member.teamId), plan: plan.plan, seats: plan.plan.team_seats });
}));

router.post("/teams/:teamId/invites", authenticate, asyncRoute(async (request, response) => {
  const member = await membership(request);
  if (!["owner", "admin"].includes(member.role)) throw new HttpError(403, "Only team owners and admins can invite people.");
  try {
    response.status(201).json(await inviteMember(member.teamId, request.user, request.body?.email, request.body?.role || "member"));
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}));

router.post("/teams/:teamId/accept", authenticate, asyncRoute(async (request, response) => {
  try {
    response.json(await acceptInvite(Number(request.params.teamId), request.user));
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}));

router.patch("/teams/:teamId/members/:memberId", authenticate, asyncRoute(async (request, response) => {
  const member = await membership(request);
  try {
    response.json(await setMemberRole(member.teamId, Number(request.params.memberId), request.body?.role, member));
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}));

router.delete("/teams/:teamId/members/:memberId", authenticate, asyncRoute(async (request, response) => {
  const member = await membership(request);
  try {
    response.json(await removeMember(member.teamId, Number(request.params.memberId), { ...member, id: request.userId }));
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}));

export default router;
