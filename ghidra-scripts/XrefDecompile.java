// Finds every defined string containing a substring, then decompiles each
// function whose code references one of those strings. Used by mcp-skills'
// bin_xref_decompile tool. Read-only.
//
// Args: <substring> [maxFunctions=5]
// Output (println, parsed by the tool):
//   STRING: <addr> <escaped value>        one per matching string
//   ===MCP_SKILLS_XREF_START===
//   FUNCTION: <name> @ <entry>
//   REFS: <from addr>,<from addr>,...     referencing instructions in this function
//   <decompiled C>
//   ===MCP_SKILLS_XREF_END===
//   SUMMARY: strings=<n> functions=<n> decompiled=<n>
//@category mcp-skills

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.util.task.ConsoleTaskMonitor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class XrefDecompile extends GhidraScript {
    private static final String START = "===MCP_SKILLS_XREF_START===";
    private static final String END = "===MCP_SKILLS_XREF_END===";

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1 || args[0].isEmpty()) {
            println("ERROR: missing substring argument");
            return;
        }
        String needle = args[0];
        int maxFunctions = args.length > 1 ? Integer.parseInt(args[1]) : 5;

        List<Address> stringAddrs = new ArrayList<>();
        DataIterator di = currentProgram.getListing().getDefinedData(true);
        while (di.hasNext() && !monitor.isCancelled()) {
            Data d = di.next();
            if (!d.hasStringValue()) continue;
            Object v = d.getValue();
            if (v == null || !v.toString().contains(needle)) continue;
            stringAddrs.add(d.getAddress());
            String esc = v.toString().replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r");
            println("STRING: " + d.getAddress() + " " + esc);
        }

        // function -> referencing instruction addresses, in discovery order
        Map<Function, List<Address>> callers = new LinkedHashMap<>();
        for (Address a : stringAddrs) {
            ReferenceIterator refs = currentProgram.getReferenceManager().getReferencesTo(a);
            while (refs.hasNext()) {
                Reference r = refs.next();
                Function f = currentProgram.getFunctionManager().getFunctionContaining(r.getFromAddress());
                if (f == null) continue;
                callers.computeIfAbsent(f, k -> new ArrayList<>()).add(r.getFromAddress());
            }
        }

        DecompInterface decompiler = new DecompInterface();
        int decompiled = 0;
        try {
            decompiler.setOptions(new DecompileOptions());
            decompiler.toggleSyntaxTree(true);
            if (!decompiler.openProgram(currentProgram)) {
                println("ERROR: failed to open program in decompiler: " + decompiler.getLastMessage());
                return;
            }
            for (Map.Entry<Function, List<Address>> e : callers.entrySet()) {
                if (decompiled >= maxFunctions || monitor.isCancelled()) break;
                Function f = e.getKey();
                DecompileResults res = decompiler.decompileFunction(f, 60, new ConsoleTaskMonitor());
                if (res == null || !res.decompileCompleted()) continue;
                StringBuilder refs = new StringBuilder();
                for (Address from : e.getValue()) {
                    if (refs.length() > 0) refs.append(",");
                    refs.append(from);
                }
                println(START);
                println("FUNCTION: " + f.getName() + " @ " + f.getEntryPoint());
                println("REFS: " + refs);
                println(res.getDecompiledFunction().getC());
                println(END);
                decompiled++;
            }
        } finally {
            decompiler.dispose();
        }
        println("SUMMARY: strings=" + stringAddrs.size() + " functions=" + callers.size() + " decompiled=" + decompiled);
    }
}
