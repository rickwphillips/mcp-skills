// Decompiles a single function and prints its pseudocode to stdout, wrapped
// in markers so a calling process can extract it without parsing Ghidra's
// other log noise. Takes one script arg: a function name, a label/symbol
// name at that function's entry (Ghidra sometimes auto-names the entry-point
// function "entry" while the real name, e.g. "_main", survives only as a
// label symbol at the same address), or a hex address. Read-only.
//@category mcp-skills

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolTable;
import ghidra.util.task.ConsoleTaskMonitor;

public class DecompileFunction extends GhidraScript {
    private static final String START = "===MCP_SKILLS_DECOMPILE_START===";
    private static final String END = "===MCP_SKILLS_DECOMPILE_END===";

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("ERROR: missing function name/address arg");
            return;
        }
        String target = args[0];

        Function func = findFunction(target);
        if (func == null) {
            println("ERROR: function not found: " + target);
            return;
        }

        DecompInterface decompiler = new DecompInterface();
        try {
            decompiler.setOptions(new DecompileOptions());
            decompiler.toggleSyntaxTree(true);
            if (!decompiler.openProgram(currentProgram)) {
                println("ERROR: failed to open program in decompiler: " + decompiler.getLastMessage());
                return;
            }
            DecompileResults results = decompiler.decompileFunction(func, 60, new ConsoleTaskMonitor());
            if (results == null || !results.decompileCompleted()) {
                println("ERROR: decompilation failed: " + (results != null ? results.getErrorMessage() : "null result"));
                return;
            }
            println(START);
            println("FUNCTION: " + func.getName() + " @ " + func.getEntryPoint());
            println(results.getDecompiledFunction().getC());
            println(END);
        } finally {
            decompiler.dispose();
        }
    }

    private Function findFunction(String target) {
        // 1. Exact function name.
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        while (it.hasNext()) {
            Function f = it.next();
            if (f.getName().equals(target)) return f;
        }

        // 2. A label/symbol with this name whose address falls inside a function
        //    (covers e.g. "_main" when Ghidra auto-named the function "entry").
        SymbolTable st = currentProgram.getSymbolTable();
        SymbolIterator si = st.getSymbolIterator(target, true);
        while (si.hasNext()) {
            Symbol s = si.next();
            Function f = currentProgram.getFunctionManager().getFunctionContaining(s.getAddress());
            if (f != null) return f;
        }

        // 3. Hex/decimal address, possibly mid-function.
        try {
            long addr = Long.decode(target);
            Address a = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(addr);
            return currentProgram.getFunctionManager().getFunctionContaining(a);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
