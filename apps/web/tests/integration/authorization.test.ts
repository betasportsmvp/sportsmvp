import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createAuthUser, createTestDatabase, type TestDb } from "./db";

// Phase 0 acceptance: user A creates a group, user B joins with a valid invite,
// and user C cannot read either user's group data.

let db: TestDb;
let alice: string;
let bob: string;
let carol: string;
let groupId: string;
let inviteToken: string;
let inviteId: string;

const key = () => `key-${crypto.randomUUID()}`;

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await createAuthUser(db.client, "alice@example.test", "Alice A");
  bob = await createAuthUser(db.client, "bob@example.test", "Bob B");
  carol = await createAuthUser(db.client, "carol@example.test", "Carol C");
});

afterAll(async () => {
  await db?.drop();
});

describe("profile bootstrap", () => {
  it("creates a profile from the Google identity", async () => {
    const { rows } = await as(db.client, alice, (q) => q("select * from public.profiles"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: alice, email: "alice@example.test", display_name: "Alice A" });
    expect(rows[0].avatar_url).toContain(alice);
  });

  it("ensure_profile is idempotent for the signed-in user", async () => {
    const { rows } = await as(db.client, alice, (q) => q("select (public.ensure_profile()).id"));
    expect(rows[0].id).toBe(alice);
  });

  it("lets a user rename themselves but not change their email or others' profiles", async () => {
    await as(db.client, bob, (q) =>
      q("update public.profiles set display_name = 'Bobby' where id = $1", [bob]),
    );
    await expect(
      as(db.client, bob, (q) => q("update public.profiles set email = 'x@y.z' where id = $1", [bob])),
    ).rejects.toThrow(/permission denied/);
    const res = await as(db.client, bob, (q) =>
      q("update public.profiles set display_name = 'hacked' where id = $1", [alice]),
    );
    expect(res.rowCount).toBe(0);
  });
});

describe("group creation", () => {
  it("rejects anonymous callers", async () => {
    await expect(
      as(db.client, null, (q) =>
        q("select public.create_group('X', 'tennis', 'UTC', 'INR', $1)", [key()]),
      ),
    ).rejects.toThrow(/permission denied/);
    const { rows } = await db.client.query("select count(*)::int as n from public.groups");
    expect(rows[0].n).toBe(0);
  });

  it("lets user A create a group and become its owner", async () => {
    const idem = key();
    groupId = await as(db.client, alice, async (q) => {
      const { rows } = await q(
        "select public.create_group('Sunday Doubles', 'Tennis', 'Asia/Kolkata', 'inr', $1) as id",
        [idem],
      );
      return rows[0].id as string;
    });

    const again = await as(db.client, alice, async (q) => {
      const { rows } = await q(
        "select public.create_group('Sunday Doubles', 'Tennis', 'Asia/Kolkata', 'inr', $1) as id",
        [idem],
      );
      return rows[0].id as string;
    });
    expect(again).toBe(groupId);

    const { rows } = await as(db.client, alice, (q) =>
      q("select g.*, m.role from public.groups g join public.memberships m on m.group_id = g.id"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Sunday Doubles",
      sport: "tennis",
      currency: "INR",
      timezone: "Asia/Kolkata",
      backdate_days: 14,
      role: "owner",
    });

    const audit = await as(db.client, alice, (q) =>
      q("select action from public.audit_events order by created_at, action"),
    );
    expect(audit.rows.map((r) => r.action).sort()).toEqual(["group.created", "membership.created"]);
  });

  it("validates the timezone", async () => {
    await expect(
      as(db.client, alice, (q) =>
        q("select public.create_group('Bad', 'tennis', 'Mars/Olympus', 'INR', $1)", [key()]),
      ),
    ).rejects.toThrow(/invalid_timezone/);
  });

  it("does not allow direct writes from the browser role", async () => {
    await expect(
      as(db.client, alice, (q) =>
        q(
          "insert into public.groups (name, owner_id) values ('Direct', $1)",
          [alice],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db.client, carol, (q) =>
        q("insert into public.memberships (group_id, user_id, role) values ($1, $2, 'owner')", [
          groupId,
          carol,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db.client, alice, (q) => q("delete from public.audit_events")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("invites", () => {
  it("only owners and admins can create invites", async () => {
    await expect(
      as(db.client, carol, (q) => q("select * from public.create_invite($1)", [groupId])),
    ).rejects.toThrow(/forbidden/);

    const invite = await as(db.client, alice, async (q) => {
      const { rows } = await q("select * from public.create_invite($1, 24, 5)", [groupId]);
      return rows[0];
    });
    inviteToken = invite.token;
    inviteId = invite.invite_id;
    expect(inviteToken).toMatch(/^[0-9a-f]{64}$/);

    const stored = await db.client.query("select token_hash from public.group_invites where id = $1", [
      inviteId,
    ]);
    expect(stored.rows[0].token_hash).not.toBe(inviteToken);
  });

  it("user B can preview a valid invite but not an invalid one", async () => {
    const { rows } = await as(db.client, bob, (q) =>
      q("select * from public.get_invite_preview($1)", [inviteToken]),
    );
    expect(rows[0]).toMatchObject({ group_name: "Sunday Doubles", already_member: false });
    expect(Number(rows[0].member_count)).toBe(1);

    await expect(
      as(db.client, bob, (q) => q("select * from public.get_invite_preview('nope')")),
    ).rejects.toThrow(/invite_invalid/);
    await expect(
      as(db.client, null, (q) => q("select * from public.get_invite_preview($1)", [inviteToken])),
    ).rejects.toThrow(/permission denied/);
  });

  it("user B cannot see the group before joining", async () => {
    const { rows } = await as(db.client, bob, (q) => q("select * from public.groups"));
    expect(rows).toHaveLength(0);
  });

  it("user B joins through the invite, idempotently", async () => {
    const idem = key();
    const joined = await as(db.client, bob, async (q) => {
      const { rows } = await q("select public.join_group_from_invite($1, $2) as id", [inviteToken, idem]);
      return rows[0].id;
    });
    expect(joined).toBe(groupId);

    await as(db.client, bob, (q) => q("select public.join_group_from_invite($1, $2)", [inviteToken, idem]));
    await as(db.client, bob, (q) => q("select public.join_group_from_invite($1, $2)", [inviteToken, key()]));

    const uses = await db.client.query("select use_count from public.group_invites where id = $1", [inviteId]);
    expect(uses.rows[0].use_count).toBe(1);

    const roster = await as(db.client, bob, (q) =>
      q("select user_id, role from public.memberships where group_id = $1 order by role", [groupId]),
    );
    expect(roster.rows).toEqual([
      { user_id: alice, role: "owner" },
      { user_id: bob, role: "member" },
    ]);

    const names = await as(db.client, bob, (q) => q("select display_name from public.profiles order by 1"));
    expect(names.rows.map((r) => r.display_name)).toEqual(["Alice A", "Bobby"]);
  });

  it("members cannot read or create invites", async () => {
    const { rows } = await as(db.client, bob, (q) => q("select * from public.group_invites"));
    expect(rows).toHaveLength(0);
    await expect(
      as(db.client, bob, (q) => q("select * from public.create_invite($1)", [groupId])),
    ).rejects.toThrow(/forbidden/);
  });

  it("rejects revoked and expired invites", async () => {
    const extra = await as(db.client, alice, async (q) => {
      const { rows } = await q("select * from public.create_invite($1, 1)", [groupId]);
      return rows[0];
    });
    await as(db.client, alice, (q) => q("select public.revoke_invite($1)", [extra.invite_id]));
    await expect(
      as(db.client, carol, (q) => q("select public.join_group_from_invite($1, $2)", [extra.token, key()])),
    ).rejects.toThrow(/invite_invalid/);

    const expiring = await as(db.client, alice, async (q) => {
      const { rows } = await q("select * from public.create_invite($1, 1)", [groupId]);
      return rows[0];
    });
    await db.client.query("update public.group_invites set expires_at = now() - interval '1 minute' where id = $1", [
      expiring.invite_id,
    ]);
    await expect(
      as(db.client, carol, (q) => q("select public.join_group_from_invite($1, $2)", [expiring.token, key()])),
    ).rejects.toThrow(/invite_invalid/);
  });
});

describe("user C (not a member)", () => {
  const tables = ["groups", "memberships", "group_invites", "sessions", "attendance", "audit_events"];

  it.each(tables)("cannot read %s", async (table) => {
    const { rows } = await as(db.client, carol, (q) => q(`select * from public.${table}`));
    expect(rows).toHaveLength(0);
  });

  it("cannot read user A's or user B's profile", async () => {
    const { rows } = await as(db.client, carol, (q) => q("select id from public.profiles"));
    expect(rows.map((r) => r.id)).toEqual([carol]);
  });

  it("cannot read the command receipts", async () => {
    await expect(
      as(db.client, carol, (q) => q("select * from public.command_receipts")),
    ).rejects.toThrow(/permission denied/);
  });

  it("anon can read nothing", async () => {
    await expect(as(db.client, null, (q) => q("select * from public.groups"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("membership management", () => {
  it("only the owner changes roles", async () => {
    await expect(
      as(db.client, bob, (q) => q("select public.set_member_role($1, $2, 'admin')", [groupId, bob])),
    ).rejects.toThrow(/forbidden/);
    await as(db.client, alice, (q) => q("select public.set_member_role($1, $2, 'admin')", [groupId, bob]));
    await expect(
      as(db.client, alice, (q) => q("select public.set_member_role($1, $2, 'owner')", [groupId, bob])),
    ).rejects.toThrow(/ownership_transfer_unsupported/);
    await as(db.client, alice, (q) => q("select public.set_member_role($1, $2, 'member')", [groupId, bob]));
  });

  it("members cannot remove anyone; the owner can, and the removed user loses access", async () => {
    await expect(
      as(db.client, bob, (q) => q("select public.remove_member($1, $2)", [groupId, alice])),
    ).rejects.toThrow(/forbidden/);
    await expect(
      as(db.client, alice, (q) => q("select public.remove_member($1, $2)", [groupId, alice])),
    ).rejects.toThrow(/cannot_remove_owner/);

    await as(db.client, alice, (q) => q("select public.remove_member($1, $2)", [groupId, bob]));
    const { rows } = await as(db.client, bob, (q) => q("select * from public.groups"));
    expect(rows).toHaveLength(0);

    const audit = await as(db.client, alice, (q) =>
      q("select action from public.audit_events where action like 'membership.%' order by created_at"),
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "membership.created",
      "membership.created",
      "membership.role_changed",
      "membership.role_changed",
      "membership.removed",
    ]);
  });
});

describe("seed data", () => {
  it("loads on top of the migrations", async () => {
    const seeded = await createTestDatabase({ seed: true });
    try {
      const { rows } = await seeded.client.query(
        "select g.name, count(m.*)::int as members from public.groups g join public.memberships m on m.group_id = g.id group by g.name",
      );
      expect(rows).toEqual([{ name: "Sunday Doubles", members: 1 }]);
    } finally {
      await seeded.drop();
    }
  });
});
