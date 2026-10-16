const messages: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  profile_missing: "We couldn't find your profile. Please sign out and sign in again.",
  forbidden: "You don't have permission to do that in this group.",
  invalid_timezone: "Choose a valid timezone.",
  invalid_expiry: "Invite expiry must be between 1 hour and 30 days.",
  invite_invalid: "This invite link is invalid, expired, or has been used up. Ask an admin for a new one.",
  ownership_transfer_unsupported: "Transferring ownership isn't available yet.",
  cannot_change_owner: "The owner's role can't be changed.",
  cannot_remove_owner: "The owner can't be removed from the group.",
  member_not_found: "That person isn't an active member of this group.",
};

/** Turns a database command error into safe, friendly copy. Unknown errors stay generic. */
export function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  const code = error?.message?.trim() ?? "";
  if (code in messages) return messages[code];
  if (error?.code === "23514") return "Some of those details aren't valid. Please check and try again.";
  return "Something went wrong. Please try again.";
}
