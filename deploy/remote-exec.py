#!/usr/bin/env python3
"""Execute commands on the cloud server via SSH with retry."""
import os
import sys
import time
import paramiko

HOST = os.environ.get("CLOUD_HOST", "")
USER = os.environ.get("CLOUD_USER", "root")
PASS = os.environ.get("CLOUD_PASS", "")

if not HOST or not PASS:
    print("Error: Set CLOUD_HOST and CLOUD_PASS environment variables.", file=sys.stderr)
    sys.exit(1)

def run(cmd, timeout=300, retries=5):
    for attempt in range(1, retries + 1):
        try:
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(HOST, username=USER, password=PASS, timeout=20, banner_timeout=60, auth_timeout=30)
            print(f">>> {cmd}")
            stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
            out = stdout.read().decode()
            err = stderr.read().decode()
            rc = stdout.channel.recv_exit_status()
            if out:
                print(out)
            if err:
                print(err, file=sys.stderr)
            ssh.close()
            return rc
        except Exception as e:
            print(f"Attempt {attempt}/{retries} failed: {e}", file=sys.stderr)
            if attempt < retries:
                wait = attempt * 10
                print(f"Waiting {wait}s before retry...", file=sys.stderr)
                time.sleep(wait)
            else:
                print("All attempts failed.", file=sys.stderr)
                return 1

if __name__ == "__main__":
    cmd = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "echo connected && uname -a"
    sys.exit(run(cmd))
