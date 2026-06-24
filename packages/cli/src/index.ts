#!/usr/bin/env node

const command = process.argv[2] ?? "help";

if (command === "help" || command === "--help" || command === "-h") {
  console.log("memtable commands: init, pack, serve, agent, proposal, ask");
} else {
  console.log(`memtable command placeholder: ${command}`);
}

