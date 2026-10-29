"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_NAV_ORDER, type NavOrder } from "@/lib/nav-order";

const NavOrderContext = createContext<NavOrder>(EMPTY_NAV_ORDER);

/** The signed-in person's own left menu order (Arrange menu order, ver_93), for every menu on the page. */
export function NavOrderProvider({ order, children }: { order: NavOrder; children: ReactNode }) {
  return <NavOrderContext.Provider value={order}>{children}</NavOrderContext.Provider>;
}

export const useNavOrder = () => useContext(NavOrderContext);
