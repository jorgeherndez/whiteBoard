import { useState } from "react";
import Menu from "./Menu";
import BoardView from "./BoardView";

export default function App() {
  const [open, setOpen] = useState<string | null>(null);
  return open ? <BoardView dir={open} onClose={() => setOpen(null)} /> : <Menu onOpen={setOpen} />;
}
