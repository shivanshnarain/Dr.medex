import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  ChevronDown,
  Search,
  Check,
  AlertCircle,
  Loader2,
  X,
  Mail,
  User,
  MapPin,
  RotateCcw
} from "lucide-react";
import {
  GeoCountry,
  GeoSubdivision,
  GeoCity,
  getAllCountries,
  getCountryByCode,
  filterCountries,
  loadSubdivisions,
  loadCities,
  getPostalSuggestions,
  validatePostalCode,
  POPULAR_COUNTRY_CODES
} from "../data/geo/geoService";
import { InternationalPhoneInput } from "./InternationalPhoneInput";

export interface AddressFormData {
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  phoneCountryCode: string;
  phoneIso: string;
  country: string;
  countryCode: string;
  state: string;
  stateCode: string;
  city: string;
  postalCode: string;
  email: string;
  streetAddress: string;
  additionalAddress: string;
  companyName?: string;
  department?: string;
  professionalTitle?: string;
  taxId?: string;
}

interface AmazonCascadingAddressFormProps {
  data: AddressFormData;
  onChange: (updated: Partial<AddressFormData>) => void;
  onCountryChange?: (country: GeoCountry) => void;
  isGeolocating?: boolean;
  onDetectLocation?: () => void;
  locationNotice?: string | null;
  onDismissLocationNotice?: () => void;
  step?: 1 | 2;
}

export const AmazonCascadingAddressForm: React.FC<AmazonCascadingAddressFormProps> = ({
  data,
  onChange,
  onCountryChange,
  isGeolocating = false,
  onDetectLocation,
  locationNotice,
  onDismissLocationNotice,
  step
}) => {
  const allCountries = useMemo(() => getAllCountries(), []);

  // Country selector dropdown state
  const [isCountryOpen, setIsCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const countryDropdownRef = useRef<HTMLDivElement>(null);

  // State / Subdivision dropdown state
  const [subdivisions, setSubdivisions] = useState<GeoSubdivision[]>([]);
  const [isLoadingSubdivisions, setIsLoadingSubdivisions] = useState(false);
  const [isStateOpen, setIsStateOpen] = useState(false);
  const [stateSearch, setStateSearch] = useState("");
  const stateDropdownRef = useRef<HTMLDivElement>(null);

  // City / Locality dropdown state
  const [cities, setCities] = useState<GeoCity[]>([]);
  const [isLoadingCities, setIsLoadingCities] = useState(false);
  const [isCityOpen, setIsCityOpen] = useState(false);
  const [citySearch, setCitySearch] = useState("");
  const [isManualCityMode, setIsManualCityMode] = useState(false);
  const cityDropdownRef = useRef<HTMLDivElement>(null);

  // Postal suggestions state
  const [postalSuggestions, setPostalSuggestions] = useState<string[]>([]);
  const [postalError, setPostalError] = useState<string | null>(null);

  // Address Autocomplete state
  const [addressAutocompleteQuery, setAddressAutocompleteQuery] = useState(data.streetAddress || "");
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const addressAutocompleteRef = useRef<HTMLDivElement>(null);
  const addressDebounceRef = useRef<any>(null);

  // Sync address input when prop updates externally (e.g. from saved address or detected location)
  useEffect(() => {
    setAddressAutocompleteQuery(data.streetAddress || "");
  }, [data.streetAddress]);

  // Phone calling code synchronization:
  // Selecting delivery country automatically updates phone code, unless customer explicitly changed phone country
  const [hasUserOverriddenPhoneCountry, setHasUserOverriddenPhoneCountry] = useState(false);
  const [phoneCountryCode, setPhoneCountryCode] = useState<string>(
    data.phoneIso || data.countryCode || "IN"
  );

  useEffect(() => {
    if (!hasUserOverriddenPhoneCountry && data.countryCode) {
      setPhoneCountryCode(data.countryCode);
    }
  }, [data.countryCode, hasUserOverriddenPhoneCountry]);

  // Prevent mobile background scroll when a selector modal is open
  useEffect(() => {
    const isAnyModalOpen = isCountryOpen || isStateOpen || isCityOpen;
    if (window.innerWidth < 640) {
      if (isAnyModalOpen) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
      }
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isCountryOpen, isStateOpen, isCityOpen]);

  // Active country resolution
  const activeCountry = useMemo<GeoCountry>(() => {
    return getCountryByCode(data.countryCode || "IN") || allCountries.find((c) => c.code === "IN") || allCountries[0];
  }, [allCountries, data.countryCode]);

  // Filtered countries for search
  const filteredCountries = useMemo(() => {
    return filterCountries(countrySearch, allCountries);
  }, [countrySearch, allCountries]);

  // Popular countries list
  const popularCountries = useMemo(() => {
    return POPULAR_COUNTRY_CODES.map((code) => allCountries.find((c) => c.code === code)).filter(Boolean) as GeoCountry[];
  }, [allCountries]);

  // Filtered subdivisions with US categorization support
  const filteredSubdivisions = useMemo(() => {
    if (!stateSearch.trim()) return subdivisions;
    const q = stateSearch.toLowerCase();
    return subdivisions.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  }, [subdivisions, stateSearch]);

  // Filtered cities
  const filteredCities = useMemo(() => {
    if (!citySearch.trim()) return cities.slice(0, 150);
    const q = citySearch.toLowerCase();
    return cities.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 150);
  }, [cities, citySearch]);

  // 1. Load Subdivisions whenever country changes
  useEffect(() => {
    let isCancelled = false;
    async function fetchSubdivisions() {
      if (!data.countryCode) return;
      setIsLoadingSubdivisions(true);
      const list = await loadSubdivisions(data.countryCode);
      if (!isCancelled) {
        setSubdivisions(list);
        setIsLoadingSubdivisions(false);

        // Auto-synchronize state and stateCode if one is missing but the other exists
        if (data.state && !data.stateCode && list.length > 0) {
          const sClean = data.state.trim().toLowerCase();
          const found = list.find(
            (s) => s.name.toLowerCase() === sClean ||
                   s.code.toLowerCase() === sClean ||
                   sClean.includes(s.name.toLowerCase()) ||
                   s.name.toLowerCase().includes(sClean)
          );
          if (found) {
            onChange({ state: found.name, stateCode: found.code });
          }
        } else if (data.stateCode && !data.state && list.length > 0) {
          const cClean = data.stateCode.trim().toLowerCase();
          const found = list.find((s) => s.code.toLowerCase() === cClean);
          if (found) {
            onChange({ state: found.name, stateCode: found.code });
          }
        }
      }
    }
    fetchSubdivisions();
    return () => {
      isCancelled = true;
    };
  }, [data.countryCode, data.state, data.stateCode]);

  // 2. Load Cities whenever country or stateCode changes
  useEffect(() => {
    let isCancelled = false;
    async function fetchCities() {
      if (!data.countryCode) return;
      setIsLoadingCities(true);
      const list = await loadCities(data.countryCode, data.stateCode);
      if (!isCancelled) {
        setCities(list);
        setIsLoadingCities(false);

        // If a city is already populated (e.g. from GPS detection or saved address)
        if (data.city) {
          const cClean = data.city.trim().toLowerCase();
          const existsInList = list.some((c) => c.name.toLowerCase() === cClean);
          if (!existsInList && list.length > 0) {
            setIsManualCityMode(true);
          } else {
            setIsManualCityMode(list.length === 0);
          }
        } else {
          setIsManualCityMode(list.length === 0);
        }
      }
    }
    fetchCities();
    return () => {
      isCancelled = true;
    };
  }, [data.countryCode, data.stateCode, data.city]);

  // 3. Load Postal Suggestions whenever city changes
  useEffect(() => {
    let isCancelled = false;
    async function fetchPostal() {
      if (!data.countryCode || !data.city) {
        setPostalSuggestions([]);
        return;
      }
      const suggestions = await getPostalSuggestions(data.countryCode, data.stateCode, data.city);
      if (!isCancelled) {
        setPostalSuggestions(suggestions);
      }
    }
    fetchPostal();
    return () => {
      isCancelled = true;
    };
  }, [data.countryCode, data.stateCode, data.city]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setIsCountryOpen(false);
      }
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(e.target as Node)) {
        setIsStateOpen(false);
      }
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(e.target as Node)) {
        setIsCityOpen(false);
      }
      if (addressAutocompleteRef.current && !addressAutocompleteRef.current.contains(e.target as Node)) {
        setShowAddressSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle Country Selection
  const handleSelectCountry = (country: GeoCountry) => {
    setIsCountryOpen(false);
    setCountrySearch("");
    setStateSearch("");
    setCitySearch("");
    setIsManualCityMode(false);
    setPostalError(null);

    // If customer has not explicitly changed the phone country, sync phone code with delivery country
    if (!hasUserOverriddenPhoneCountry) {
      setPhoneCountryCode(country.code);
    }

    // Cascading reset: clear state, city, and postal code
    onChange({
      country: country.name,
      countryCode: country.code,
      state: "",
      stateCode: "",
      city: "",
      postalCode: "",
      ...(!hasUserOverriddenPhoneCountry
        ? {
            phoneCountryCode: country.dialCode,
            phoneIso: country.code
          }
        : {})
    });

    if (onCountryChange) {
      onCountryChange(country);
    }
  };

  // Handle State Selection
  const handleSelectState = (sub: GeoSubdivision) => {
    setIsStateOpen(false);
    setStateSearch("");
    setCitySearch("");
    setIsManualCityMode(false);
    setPostalError(null);

    // Cascading reset: clear city and postal code
    onChange({
      state: sub.name,
      stateCode: sub.code,
      city: "",
      postalCode: ""
    });
  };

  // Handle City Selection
  const handleSelectCity = (cityItem: GeoCity) => {
    setIsCityOpen(false);
    setCitySearch("");
    setPostalError(null);

    // Suggest first postal code if single exact match, otherwise let customer choose from pills
    const suggestions = cityItem.postalCodes || [];
    setPostalSuggestions(suggestions);

    onChange({
      city: cityItem.name,
      postalCode: suggestions.length === 1 ? suggestions[0] : (data.postalCode || "")
    });
  };

  // Validate postal code on blur or change
  const handlePostalChange = (val: string) => {
    onChange({ postalCode: val });
    if (activeCountry.hasPostalCode && val.trim().length > 0) {
      const result = validatePostalCode(activeCountry.code, val);
      setPostalError(result.valid ? null : (result.message || "Invalid postal format"));
    } else {
      setPostalError(null);
    }
  };

  // Address Autocomplete Input Handler (debounced)
  const handleAddressInputChange = (val: string) => {
    setAddressAutocompleteQuery(val);
    onChange({ streetAddress: val });

    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (!val || val.trim().length < 3) {
      setAddressSuggestions([]);
      setShowAddressSuggestions(false);
      return;
    }

    setIsSearchingAddress(true);
    addressDebounceRef.current = setTimeout(async () => {
      try {
        const countryParam = encodeURIComponent(data.countryCode || "IN");
        const res = await fetch(`/api/location/autocomplete?query=${encodeURIComponent(val)}&countryCode=${countryParam}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.suggestions) && json.suggestions.length > 0) {
            setAddressSuggestions(json.suggestions);
            setShowAddressSuggestions(true);
          } else {
            setAddressSuggestions([]);
          }
        }
      } catch (err) {
        setAddressSuggestions([]);
      } finally {
        setIsSearchingAddress(false);
      }
    }, 300);
  };

  // Select Address Autocomplete Suggestion
  const handleSelectAddressSuggestion = (sug: any) => {
    setShowAddressSuggestions(false);
    setAddressSuggestions([]);
    const cleanStreet = sug.addressLine1 || sug.formattedAddress || "";
    setAddressAutocompleteQuery(cleanStreet);

    const updates: Partial<AddressFormData> = {
      streetAddress: cleanStreet
    };

    if (sug.city) {
      updates.city = sug.city;
      setIsManualCityMode(true);
    }
    if (sug.state) {
      updates.state = sug.state;
      if (sug.stateCode) updates.stateCode = sug.stateCode;
    }
    if (sug.postalCode) {
      updates.postalCode = sug.postalCode;
    }
    onChange(updates);
  };

  // Synchronize first & last name with fullName
  const handleFirstNameChange = (val: string) => {
    const newFull = `${val} ${data.lastName || ""}`.trim();
    onChange({ firstName: val, fullName: newFull });
  };

  const handleLastNameChange = (val: string) => {
    const newFull = `${data.firstName || ""} ${val}`.trim();
    onChange({ lastName: val, fullName: newFull });
  };

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-7 shadow-xs">
      {/* ADDRESS CARD HEADING WITH EXPLICIT "USE MY CURRENT LOCATION" CTA */}
      <div className="pb-3 mb-4 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin size={18} className="text-[#2D5A4A]" />
          <h2 className="text-sm font-extrabold text-[#2D5A4A] uppercase tracking-wider">
            DELIVERY ADDRESS
          </h2>
        </div>

        {onDetectLocation && (
          <button
            type="button"
            onClick={onDetectLocation}
            disabled={isGeolocating}
            className="flex items-center gap-1.5 text-xs font-bold text-[#2D5A4A] hover:text-[#0D4C3C] bg-[#F4F7F2] hover:bg-[#EBF3E8] px-3 py-1.5 rounded-lg border border-[#7AA05A]/30 transition-all disabled:opacity-50 cursor-pointer shadow-2xs"
            title="Detect delivery location using GPS / Network"
          >
            {isGeolocating ? (
              <Loader2 size={13} className="animate-spin text-[#7AA05A]" />
            ) : (
              <MapPin size={13} className="text-[#7AA05A]" />
            )}
            <span>{isGeolocating ? "Detecting location..." : "Use my current location"}</span>
          </button>
        )}
      </div>

      {/* Geolocation Notice Banner */}
      {(!step || step === 2) && locationNotice && (
        <div className="mb-4 flex items-start sm:items-center justify-between gap-2 p-3 rounded-xl bg-[#F0F7ED] border border-[#7AA05A]/40 text-xs font-semibold text-[#2D5A4A] animate-in fade-in duration-200">
          <div className="flex items-start sm:items-center gap-2">
            {isGeolocating ? (
              <Loader2 size={16} className="text-[#7AA05A] animate-spin shrink-0 mt-0.5 sm:mt-0" />
            ) : (
              <Check size={16} className="text-[#7AA05A] shrink-0 mt-0.5 sm:mt-0" />
            )}
            <span className="leading-relaxed">{locationNotice}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onDetectLocation && locationNotice.toLowerCase().includes("approximate") && (
              <button
                type="button"
                onClick={onDetectLocation}
                disabled={isGeolocating}
                className="text-2xs font-bold text-[#2D5A4A] hover:underline flex items-center gap-1 px-2 py-0.5 bg-white/80 rounded border border-[#7AA05A]/30"
              >
                <RotateCcw size={11} /> Retry
              </button>
            )}
            {onDismissLocationNotice && (
              <button
                type="button"
                onClick={onDismissLocationNotice}
                className="text-neutral-400 hover:text-neutral-700 p-1 rounded hover:bg-black/5 cursor-pointer"
                title="Dismiss notice"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ========================================================
          CASCADING ADDRESS FORM (EXACT FIELD ORDER 1 TO 10)
         ======================================================== */}
      <div className="space-y-4 text-sm sm:text-xs">
        
        {/* STEP 1: CUSTOMER DETAILS (Fields 1 to 4) */}
        {(!step || step === 1) && (
          <>
            {/* 1. First Name * & 2. Last Name * */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-[#171717] mb-1.5">
                  First Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={data.firstName || ""}
                    onChange={(e) => handleFirstNameChange(e.target.value)}
                    placeholder="Enter first name"
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[16px] sm:text-xs text-[#171717] font-medium focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all placeholder:text-neutral-400"
                  />
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#171717] mb-1.5">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={data.lastName || ""}
                  onChange={(e) => handleLastNameChange(e.target.value)}
                  placeholder="Enter last name"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[16px] sm:text-xs text-[#171717] font-medium focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all placeholder:text-neutral-400"
                />
              </div>
            </div>

            {/* 3. Email Address * */}
            <div>
              <label className="block font-bold text-[#171717] mb-1.5">
                Email Address <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={data.email || ""}
                  onChange={(e) => onChange({ email: e.target.value })}
                  placeholder="Enter your email address (personal or institutional)"
                  className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[16px] sm:text-xs text-[#171717] font-medium focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all placeholder:text-neutral-400"
                />
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              </div>
            </div>

            {/* 4. Phone Number * (Country Flag Selector, Calling Code Selector, Phone Number Input) */}
            <div>
              <label className="block font-bold text-[#171717] mb-1.5">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <InternationalPhoneInput
                value={data.phone || ""}
                onChange={(val) => onChange({ phone: val })}
                countryCode={phoneCountryCode}
                onCountryChange={(code) => {
                  setHasUserOverriddenPhoneCountry(true);
                  setPhoneCountryCode(code);
                }}
                required
                placeholder="Enter phone number"
              />
            </div>
          </>
        )}

        {/* STEP 2: SHIPPING ADDRESS (Fields 5 to 10 + Tax ID) */}
        {(!step || step === 2) && (
          <>

            {/* 5. Country * (195 Sovereign Countries Dropdown / Mobile Sheet) */}
            <div className="relative" ref={countryDropdownRef}>
              <label className="block font-bold text-[#171717] mb-1.5">
                Country / Region <span className="text-red-500">*</span>
              </label>

              <button
                type="button"
                onClick={() => setIsCountryOpen(!isCountryOpen)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[#171717] font-semibold hover:border-neutral-400 focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <span className="text-lg leading-none">{activeCountry.flag}</span>
                  <span className="font-bold text-sm text-[#171717] truncate">{activeCountry.name}</span>
                  <span className="text-2xs font-mono text-neutral-400">({activeCountry.code})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-2xs font-bold text-[#2D5A4A] bg-[#F4F7F2] px-2 py-0.5 rounded">
                    {activeCountry.dialCode}
                  </span>
                  <span className="text-2xs text-neutral-500 font-mono hidden sm:inline">
                    {activeCountry.currency} ({activeCountry.symbol})
                  </span>
                  <ChevronDown size={15} className={`text-neutral-400 transition-transform ${isCountryOpen ? "rotate-180" : ""}`} />
                </div>
              </button>

              {/* Responsive Dropdown / Mobile Sheet */}
              {isCountryOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end sm:static sm:z-50 sm:bg-transparent sm:backdrop-blur-none sm:block">
                  <div className="bg-white w-full rounded-t-3xl sm:rounded-xl max-h-[85vh] sm:max-h-80 flex flex-col shadow-2xl sm:shadow-xl sm:border sm:border-neutral-200 sm:absolute sm:top-full sm:left-0 sm:right-0 sm:mt-1.5 animate-in slide-in-from-bottom sm:slide-in-from-top-1 duration-200">
                    {/* Mobile Sheet Header */}
                    <div className="sm:hidden px-4 pt-3 pb-2 flex items-center justify-between border-b border-neutral-100">
                      <div>
                        <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto mb-2" />
                        <h3 className="font-bold text-sm text-[#171717]">Select Country</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCountryOpen(false);
                          setCountrySearch("");
                        }}
                        className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-full hover:bg-neutral-100 cursor-pointer"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div className="p-3 border-b border-neutral-100 bg-white sticky top-0 z-10">
                      <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="text"
                          value={countrySearch}
                          onChange={(e) => setCountrySearch(e.target.value)}
                          placeholder="Search country, calling code (+91, +1), or ISO..."
                          className="w-full pl-9 pr-8 py-2 text-[16px] sm:text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#7AA05A] text-neutral-800"
                          autoFocus
                        />
                        {countrySearch && (
                          <button
                            type="button"
                            onClick={() => setCountrySearch("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-1"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="overflow-y-auto flex-1 max-h-[60vh] sm:max-h-64 divide-y divide-neutral-50 overscroll-contain">
                      {/* Popular Procurement Hubs */}
                      {!countrySearch && (
                        <div>
                          <div className="px-3.5 py-1.5 text-3xs font-extrabold uppercase tracking-wider text-neutral-400 bg-neutral-50">
                            Popular Procurement Hubs
                          </div>
                          {popularCountries.map((c) => (
                            <button
                              key={`pop-${c.code}`}
                              type="button"
                              onClick={() => handleSelectCountry(c)}
                              className={`w-full flex items-center justify-between px-4 py-3 sm:py-2 hover:bg-[#F4F7F2] text-left transition-colors min-h-[44px] sm:min-h-0 cursor-pointer ${
                                c.code === data.countryCode ? "bg-[#7AA05A]/10 font-bold text-[#2D5A4A]" : "text-neutral-800"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 truncate pr-2">
                                <span className="text-base">{c.flag}</span>
                                <span className="truncate text-sm sm:text-xs">{c.name}</span>
                                <span className="text-3xs font-mono text-neutral-400">({c.code})</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono text-xs sm:text-2xs text-neutral-500 font-semibold">{c.dialCode}</span>
                                <span className="text-3xs font-semibold text-neutral-400 hidden sm:inline">{c.currency}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* All 195 Countries List */}
                      <div>
                        {!countrySearch && (
                          <div className="px-3.5 py-1.5 text-3xs font-extrabold uppercase tracking-wider text-neutral-400 bg-neutral-50">
                            All 195 Sovereign Countries
                          </div>
                        )}
                        {filteredCountries.length === 0 ? (
                          <div className="px-4 py-6 text-xs text-neutral-500 text-center">
                            No country or calling code matched.
                          </div>
                        ) : (
                          filteredCountries.map((c) => (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => handleSelectCountry(c)}
                              className={`w-full flex items-center justify-between px-4 py-3 sm:py-2 hover:bg-[#F4F7F2] text-left transition-colors min-h-[44px] sm:min-h-0 cursor-pointer ${
                                c.code === data.countryCode ? "bg-[#7AA05A]/10 font-bold text-[#2D5A4A]" : "text-neutral-800"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 truncate pr-2">
                                <span className="text-base">{c.flag}</span>
                                <span className="truncate text-sm sm:text-xs">{c.name}</span>
                                <span className="text-3xs font-mono text-neutral-400">({c.code})</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono text-xs sm:text-2xs text-neutral-500 font-semibold">{c.dialCode}</span>
                                <span className="text-3xs font-semibold text-neutral-400 hidden sm:inline">{c.currency}</span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 6. State / Province / Region * */}
            {activeCountry.hasStates !== false && (
              <div className="relative" ref={stateDropdownRef}>
                <label className="block font-bold text-[#171717] mb-1.5">
                  {activeCountry.stateLabel || "State / Province / Region"} <span className="text-red-500">*</span>
                </label>

                {isLoadingSubdivisions ? (
                  <div className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-400 flex items-center gap-2">
                    <Loader2 size={13} className="animate-spin text-[#7AA05A]" />
                    <span>Loading subdivisions for {activeCountry.name}...</span>
                  </div>
                ) : subdivisions.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsStateOpen(!isStateOpen)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[#171717] font-medium hover:border-neutral-400 focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all text-left cursor-pointer"
                    >
                      <span className={data.state ? "font-semibold text-[#171717]" : "text-neutral-400"}>
                        {data.state || `Select ${activeCountry.stateLabel || "state/province"}...`}
                      </span>
                      <ChevronDown size={15} className={`text-neutral-400 transition-transform ${isStateOpen ? "rotate-180" : ""}`} />
                    </button>

                    {/* Responsive Dropdown / Mobile Sheet */}
                    {isStateOpen && (
                      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end sm:static sm:z-40 sm:bg-transparent sm:backdrop-blur-none sm:block">
                        <div className="bg-white w-full rounded-t-3xl sm:rounded-xl max-h-[85vh] sm:max-h-72 flex flex-col shadow-2xl sm:shadow-xl sm:border sm:border-neutral-200 sm:absolute sm:top-full sm:left-0 sm:right-0 sm:mt-1.5 animate-in slide-in-from-bottom sm:slide-in-from-top-1 duration-200">
                          {/* Mobile Sheet Header */}
                          <div className="sm:hidden px-4 pt-3 pb-2 flex items-center justify-between border-b border-neutral-100">
                            <div>
                              <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto mb-2" />
                              <h3 className="font-bold text-sm text-[#171717]">Select {activeCountry.stateLabel || "State"}</h3>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setIsStateOpen(false);
                                setStateSearch("");
                              }}
                              className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-full hover:bg-neutral-100 cursor-pointer"
                            >
                              <X size={18} />
                            </button>
                          </div>

                          <div className="p-3 border-b border-neutral-100 bg-white sticky top-0 z-10">
                            <div className="relative">
                              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                              <input
                                type="text"
                                value={stateSearch}
                                onChange={(e) => setStateSearch(e.target.value)}
                                placeholder={`Search in ${subdivisions.length} subdivisions...`}
                                className="w-full pl-9 pr-8 py-2 text-[16px] sm:text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#7AA05A] text-neutral-800"
                                autoFocus
                              />
                              {stateSearch && (
                                <button
                                  type="button"
                                  onClick={() => setStateSearch("")}
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-1"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="overflow-y-auto flex-1 max-h-[60vh] sm:max-h-56 divide-y divide-neutral-50 overscroll-contain">
                            {filteredSubdivisions.length === 0 ? (
                              <div className="px-4 py-6 text-xs text-neutral-500 text-center">
                                No matching subdivision found.
                              </div>
                            ) : (
                              filteredSubdivisions.map((s) => (
                                <button
                                  key={s.code}
                                  type="button"
                                  onClick={() => handleSelectState(s)}
                                  className={`w-full flex items-center justify-between px-4 py-3 sm:py-2 hover:bg-[#F4F7F2] text-left transition-colors min-h-[44px] sm:min-h-0 cursor-pointer ${
                                    s.name === data.state || s.code === data.stateCode ? "bg-[#7AA05A]/10 font-bold text-[#2D5A4A]" : "text-neutral-800"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 truncate pr-2">
                                    <span className="truncate text-sm sm:text-xs">{s.name}</span>
                                    {s.category === "Territory" && (
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                                        Territory
                                      </span>
                                    )}
                                    {s.category === "Federal District" && (
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 bg-blue-100 px-1.5 py-0.5 rounded">
                                        District
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-xs sm:text-3xs font-mono text-neutral-400 font-semibold shrink-0">{s.code}</span>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <input
                    type="text"
                    required
                    value={data.state || ""}
                    onChange={(e) => onChange({ state: e.target.value, stateCode: "" })}
                    placeholder={`Enter ${activeCountry.stateLabel || "state or region"}`}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[16px] sm:text-xs text-[#171717] font-medium focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all placeholder:text-neutral-400"
                  />
                )}
              </div>
            )}

            {/* 7. City / Locality * */}
            <div className="relative" ref={cityDropdownRef}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block font-bold text-[#171717]">
                  City / Locality <span className="text-red-500">*</span>
                </label>
                {cities.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsManualCityMode(!isManualCityMode)}
                    className="text-xs sm:text-3xs text-[#2D5A4A] hover:underline cursor-pointer font-bold"
                  >
                    {isManualCityMode ? "Select from list" : "Enter manually"}
                  </button>
                )}
              </div>

              {isLoadingCities ? (
                <div className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-400 flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin text-[#7AA05A]" />
                  <span>Loading cities...</span>
                </div>
              ) : !isManualCityMode && cities.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsCityOpen(!isCityOpen)}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[#171717] font-medium hover:border-neutral-400 focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all text-left cursor-pointer"
                  >
                    <span className={data.city ? "font-semibold text-[#171717]" : "text-neutral-400"}>
                      {data.city || (data.state ? `Select city in ${data.state}...` : `Select city in ${activeCountry.name}...`)}
                    </span>
                    <ChevronDown size={15} className={`text-neutral-400 transition-transform ${isCityOpen ? "rotate-180" : ""}`} />
                  </button>

                  {/* Responsive Dropdown / Mobile Sheet */}
                  {isCityOpen && (
                    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end sm:static sm:z-40 sm:bg-transparent sm:backdrop-blur-none sm:block">
                      <div className="bg-white w-full rounded-t-3xl sm:rounded-xl max-h-[85vh] sm:max-h-72 flex flex-col shadow-2xl sm:shadow-xl sm:border sm:border-neutral-200 sm:absolute sm:top-full sm:left-0 sm:right-0 sm:mt-1.5 animate-in slide-in-from-bottom sm:slide-in-from-top-1 duration-200">
                        {/* Mobile Sheet Header */}
                        <div className="sm:hidden px-4 pt-3 pb-2 flex items-center justify-between border-b border-neutral-100">
                          <div>
                            <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto mb-2" />
                            <h3 className="font-bold text-sm text-[#171717]">Select City / Locality</h3>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsCityOpen(false);
                              setCitySearch("");
                            }}
                            className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-full hover:bg-neutral-100 cursor-pointer"
                          >
                            <X size={18} />
                          </button>
                        </div>

                        <div className="p-3 border-b border-neutral-100 bg-white sticky top-0 z-10">
                          <div className="relative">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input
                              type="text"
                              value={citySearch}
                              onChange={(e) => setCitySearch(e.target.value)}
                              placeholder={`Search in ${cities.length} localities...`}
                              className="w-full pl-9 pr-8 py-2 text-[16px] sm:text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#7AA05A] text-neutral-800"
                              autoFocus
                            />
                            {citySearch && (
                              <button
                                type="button"
                                onClick={() => setCitySearch("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-1"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="overflow-y-auto flex-1 max-h-[60vh] sm:max-h-56 divide-y divide-neutral-50 overscroll-contain">
                          {filteredCities.length === 0 ? (
                            <div className="p-4 text-center space-y-2">
                              <div className="text-xs text-neutral-500">City not found in standard directory.</div>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsManualCityMode(true);
                                  setIsCityOpen(false);
                                  onChange({ city: citySearch });
                                }}
                                className="text-xs text-[#2D5A4A] font-bold underline cursor-pointer"
                              >
                                Use "{citySearch}" as city name
                              </button>
                            </div>
                          ) : (
                            filteredCities.map((c, idx) => (
                              <button
                                key={`${c.name}-${idx}`}
                                type="button"
                                onClick={() => handleSelectCity(c)}
                                className={`w-full flex items-center justify-between px-4 py-3 sm:py-2 hover:bg-[#F4F7F2] text-left transition-colors min-h-[44px] sm:min-h-0 cursor-pointer ${
                                  c.name === data.city ? "bg-[#7AA05A]/10 font-bold text-[#2D5A4A]" : "text-neutral-800"
                                }`}
                              >
                                <span className="truncate text-sm sm:text-xs">{c.name}</span>
                                {c.postalCodes && c.postalCodes.length > 0 && (
                                  <span className="text-xs sm:text-3xs font-mono text-[#2D5A4A] bg-[#EBF3E8] px-2 py-0.5 rounded font-semibold shrink-0">
                                    {c.postalCodes[0]}
                                  </span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <input
                  type="text"
                  required
                  value={data.city || ""}
                  onChange={(e) => onChange({ city: e.target.value })}
                  placeholder="Enter your city / locality"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[16px] sm:text-xs text-[#171717] font-medium focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all placeholder:text-neutral-400"
                />
              )}
            </div>

            {/* 8. ZIP / Postal Code (with Suggestion Pills & Validation) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block font-bold text-[#171717]">
                  {activeCountry.postalLabel || "Postal Code"}{" "}
                  {activeCountry.hasPostalCode ? (
                    <span className="text-red-500">*</span>
                  ) : (
                    <span className="text-neutral-400 font-normal">(Optional / Not Required in {activeCountry.name})</span>
                  )}
                </label>
                {activeCountry.hasPostalCode && (
                  <span className="text-3xs text-neutral-400 font-mono hidden sm:inline">
                    {activeCountry.postalPlaceholder}
                  </span>
                )}
              </div>

              <div className="relative">
                <input
                  type="text"
                  required={activeCountry.hasPostalCode}
                  value={data.postalCode || ""}
                  onChange={(e) => handlePostalChange(e.target.value)}
                  placeholder={activeCountry.postalPlaceholder}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-[16px] sm:text-xs text-[#171717] font-medium focus:outline-none transition-all placeholder:text-neutral-400 ${
                    postalError
                      ? "border-red-400 bg-red-50/20 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                      : "border-neutral-300 bg-white focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20"
                  }`}
                />
                {postalError && (
                  <div className="flex items-center gap-1.5 mt-1 text-2xs text-red-600 font-medium">
                    <AlertCircle size={12} className="shrink-0" />
                    <span>{postalError}</span>
                  </div>
                )}
              </div>

              {/* Postal Code Suggestion Pills for Selected City */}
              {postalSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-3xs text-neutral-400 font-semibold uppercase tracking-wider mr-1">
                    Suggested for {data.city}:
                  </span>
                  {postalSuggestions.map((pCode) => (
                    <button
                      key={pCode}
                      type="button"
                      onClick={() => handlePostalChange(pCode)}
                      className={`text-xs sm:text-2xs font-mono px-2.5 py-1 sm:py-0.5 rounded-md border transition-all cursor-pointer ${
                        data.postalCode === pCode
                          ? "bg-[#2D5A4A] text-white border-[#2D5A4A] font-bold"
                          : "bg-[#F4F7F2] text-[#2D5A4A] border-[#7AA05A]/30 hover:bg-[#EBF3E8]"
                      }`}
                      title={`Use suggested postal code ${pCode}`}
                    >
                      {pCode}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 9. Full Address * (with Country-Aware Autocomplete & Manual Entry) */}
            <div className="relative" ref={addressAutocompleteRef}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block font-bold text-[#171717]">
                  Full Delivery Address <span className="text-red-500">*</span>
                </label>
                {isSearchingAddress && (
                  <span className="flex items-center gap-1 text-3xs text-[#7AA05A]">
                    <Loader2 size={11} className="animate-spin" />
                    <span>Searching address...</span>
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={addressAutocompleteQuery}
                  onChange={(e) => handleAddressInputChange(e.target.value)}
                  onFocus={() => {
                    if (addressSuggestions.length > 0) setShowAddressSuggestions(true);
                  }}
                  placeholder="Building number, street name, surgical wing or medical center"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[16px] sm:text-xs text-[#171717] font-medium focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all placeholder:text-neutral-400"
                />
              </div>

              {/* Autocomplete Suggestions Menu */}
              {showAddressSuggestions && addressSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-xl shadow-xl z-30 py-1.5 max-h-56 overflow-y-auto divide-y divide-neutral-100 animate-in fade-in duration-100">
                  <div className="px-3 py-1 text-3xs font-extrabold uppercase tracking-wider text-neutral-400 bg-neutral-50 flex items-center justify-between">
                    <span>Address Suggestions ({activeCountry.name})</span>
                    <span className="text-neutral-400 font-normal">Tap to auto-fill</span>
                  </div>
                  {addressSuggestions.map((sug, idx) => (
                    <button
                      key={`${sug.formattedAddress}-${idx}`}
                      type="button"
                      onClick={() => handleSelectAddressSuggestion(sug)}
                      className="w-full px-3.5 py-2.5 text-left hover:bg-[#F4F7F2] flex items-start gap-2.5 transition-colors cursor-pointer group"
                    >
                      <MapPin size={14} className="text-[#7AA05A] shrink-0 mt-0.5" />
                      <div className="truncate text-left">
                        <div className="font-bold text-xs text-[#171717] group-hover:text-[#2D5A4A] truncate">
                          {sug.addressLine1 || sug.formattedAddress}
                        </div>
                        {sug.formattedAddress && sug.formattedAddress !== sug.addressLine1 && (
                          <div className="text-3xs text-neutral-500 truncate mt-0.5">
                            {sug.formattedAddress}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 10. Apartment / Suite / Building (Optional) */}
            <div>
              <label className="block font-bold text-[#171717] mb-1.5">
                Apartment / Suite / Department <span className="text-neutral-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={data.additionalAddress || ""}
                onChange={(e) => onChange({ additionalAddress: e.target.value })}
                placeholder="Floor, suite, building, surgical wing, receiving dock"
                className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 bg-white text-[16px] sm:text-xs text-[#171717] font-medium focus:outline-none focus:border-[#7AA05A] focus:ring-2 focus:ring-[#7AA05A]/20 transition-all placeholder:text-neutral-400"
              />
            </div>

            {/* Optional Tax ID (VAT / GST) */}
            <div className="pt-2 border-t border-neutral-100">
              <label className="block font-semibold text-[#171717] mb-1 text-3xs">
                VAT / GST / Tax ID <span className="text-neutral-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={data.taxId || ""}
                onChange={(e) => onChange({ taxId: e.target.value })}
                placeholder="e.g. GSTIN, EU VAT, EIN (Optional)"
                className="w-full sm:w-1/2 px-3 py-2 rounded-lg border border-neutral-200 bg-white text-[16px] sm:text-xs text-[#171717] focus:outline-none focus:border-[#7AA05A] uppercase"
              />
            </div>
          </>
        )}

      </div>
    </div>
  );
};
