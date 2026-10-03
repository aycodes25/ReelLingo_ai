import { planFor } from "./accounts.js";
import { config } from "./config.js";
import { many, one, query } from "./db.js";
import { logger } from "./logger.js";
import { sendEmail } from "./notify.js";

const ROLES = new Set(["owner", "admin", "member"]);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function createTeam(user, name) {
  const cleanName = String(name || "").trim().slice(0, 60);
  if (!cleanName) throw new Error("Give your team a name.");
  const team = await one("INSERT INTO teams (name, owner_id) VALUES ($1, $2) RETURNING *", [cleanName, user.id]);
  await query("INSERT INTO team_members (team_id, user_id, email, role, status) VALUES ($1, $2, $3, 'owner', 'active')", [team.id, user.id, normalizeEmail(user.email) || `${user.id}@users`]);
  return { id: Number(team.id), name: team.name, role: "owner" };
}

/** Teams the user belongs to, plus invitations waiting for them (matched by email). */
export async function listTeamsFor(user) {
  const email = normalizeEmail(user.email);
  const rows = await many(
    `SELECT teams.id, teams.name, team_members.role, team_members.status FROM team_members JOIN teams ON teams.id = team_members.team_id
     WHERE team_members.user_id = $1 OR (team_members.status = 'invited' AND team_members.email = $2) ORDER BY teams.name`,
    [user.id, email],
  );
  return rows.map((row) => ({ id: Number(row.id), name: row.name, role: row.role, status: row.status }));
}

export async function getMembership(teamId, userId) {
  const row = await one("SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'active'", [teamId, userId]);
  return row ? { teamId: Number(row.team_id), role: row.role } : null;
}

export async function listMembers(teamId) {
  return (await many("SELECT id, user_id, email, role, status, created_at FROM team_members WHERE team_id = $1 ORDER BY status, role, email", [teamId]))
    .map((row) => ({ ...row, id: Number(row.id) }));
}

export async function getTeam(teamId) {
  const row = await one("SELECT * FROM teams WHERE id = $1", [teamId]);
  return row ? { id: Number(row.id), name: row.name, owner_id: row.owner_id } : null;
}

export async function inviteMember(teamId, inviter, email, role = "member") {
  const address = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new Error("Enter a valid email address.");
  if (!ROLES.has(role) || role === "owner") throw new Error("Invalid role.");
  const plan = await planFor({ userId: inviter.id, teamId });
  const seats = await one("SELECT COUNT(*) AS count FROM team_members WHERE team_id = $1", [teamId]);
  if (Number(seats?.count || 0) >= plan.plan.team_seats) {
    throw new Error(`This team's ${plan.plan.name} plan includes ${plan.plan.team_seats} seat${plan.plan.team_seats === 1 ? "" : "s"}. Upgrade the team to the Studio plan to add more people.`);
  }
  const existing = await one("SELECT * FROM team_members WHERE team_id = $1 AND email = $2", [teamId, address]);
  if (existing) throw new Error("That person is already on the team or invited.");
  await query("INSERT INTO team_members (team_id, email, role, status) VALUES ($1, $2, $3, 'invited')", [teamId, address, role]);
  const team = await getTeam(teamId);
  try {
    await sendEmail({
      userId: inviter.id, operation: "team_invite",
      to: address,
      subject: `You're invited to ${team.name} on ReelLingo`,
      text: `${inviter.email || "A teammate"} invited you to join "${team.name}" on ReelLingo. Sign in with this email address to accept: ${config.frontendUrl}/teams`,
      html: `<p>${inviter.email || "A teammate"} invited you to join <strong>${team.name}</strong> on ReelLingo.</p><p><a href="${config.frontendUrl}/teams">Sign in with this email address to accept</a></p>`,
    });
  } catch (error) {
    logger.warn({ err: error }, "Team invite email failed");
  }
  return listMembers(teamId);
}

export async function acceptInvite(teamId, user) {
  const result = await query(
    "UPDATE team_members SET user_id = $1, status = 'active' WHERE team_id = $2 AND email = $3 AND status = 'invited'",
    [user.id, teamId, normalizeEmail(user.email)],
  );
  if (!result.rowCount) throw new Error("No pending invitation for your email address.");
  return getMembership(teamId, user.id);
}

export async function removeMember(teamId, memberId, actor) {
  const member = await one("SELECT * FROM team_members WHERE id = $1 AND team_id = $2", [memberId, teamId]);
  if (!member) throw new Error("Member not found.");
  if (member.role === "owner") throw new Error("The team owner can't be removed.");
  const leaving = member.user_id === actor.id;
  if (!leaving && !["owner", "admin"].includes(actor.role)) throw new Error("Only team owners and admins can remove people.");
  await query("DELETE FROM team_members WHERE id = $1", [memberId]);
  return listMembers(teamId);
}

export async function setMemberRole(teamId, memberId, role, actor) {
  if (actor.role !== "owner") throw new Error("Only the team owner can change roles.");
  if (!ROLES.has(role) || role === "owner") throw new Error("Invalid role.");
  await query("UPDATE team_members SET role = $1 WHERE id = $2 AND team_id = $3 AND role <> 'owner'", [role, memberId, teamId]);
  return listMembers(teamId);
}
