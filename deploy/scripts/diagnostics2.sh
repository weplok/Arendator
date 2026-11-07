#!/bin/sh

{
  echo "=== ADDRESS ==="
  ip -br address
  ip route

  echo "=== UFW ==="
  sudo ufw status verbose
  sudo ufw status numbered

  echo "=== NFTABLES ==="
  sudo nft list ruleset

  echo "=== IPTABLES FILTER ==="
  sudo iptables -S
  sudo iptables -L -n -v

  echo "=== IPTABLES NAT ==="
  sudo iptables -t nat -S
} 2>&1 | tee ~/network-diag.txt
