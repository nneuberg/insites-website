"""Run manually after approval; outputs only SHA256 verifiers, never tokens."""
import getpass
import hashlib
import sys
import warnings


def verifier(value):
    if not isinstance(value, str) or len(value) < 32 or len(value) > 256 or not value.isascii() or any(c.isspace() for c in value):
        raise ValueError('Use a distinct password-manager-generated 32-256 character ASCII token with no whitespace.')
    return hashlib.sha256(value.encode('ascii')).hexdigest()


def main():
    if len(sys.argv) != 1 or not sys.stdin.isatty():
        raise ValueError('Interactive terminal required. Do not pass tokens as arguments or pipe input.')
    # Refuse getpass fallback rather than allow an echoed secret.
    warnings.simplefilter('error', getpass.GetPassWarning)
    owner = getpass.getpass('Owner token (hidden): ')
    if owner != getpass.getpass('Confirm owner token (hidden): '):
        raise ValueError('Owner confirmation mismatch.')
    bridge = getpass.getpass('Bridge token (hidden): ')
    if bridge != getpass.getpass('Confirm bridge token (hidden): '):
        raise ValueError('Bridge confirmation mismatch.')
    if owner == bridge:
        raise ValueError('Owner and bridge credentials must differ.')
    owner_hash, bridge_hash = verifier(owner), verifier(bridge)
    print('HIVE_CARDS_OWNER_TOKEN_SHA256=' + owner_hash)
    print('HIVE_CARDS_BRIDGE_TOKEN_SHA256=' + bridge_hash)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, getpass.GetPassWarning, EOFError, KeyboardInterrupt):
        # No exception representation, traceback, raw input, file or network I/O.
        print('No verifiers produced. Check hidden terminal input, token format and distinct matching confirmations.', file=sys.stderr)
        sys.exit(1)
