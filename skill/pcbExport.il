; PcbToJson v0.8 Core baseline (non-destructive)
; One entry, one JSON file. This is a collector BASELINE, not validated full film geometry.
; Execute: load("pcbExport.il")  pcbExport()
;
; Use SKILL %L serialization for strings (quoted SKILL literals); test non-ASCII,
; quote/control-character escaping with the provided Python validator.
procedure(pjt08Quote(value)
  if(value then sprintf(nil "%L" value) else "null")
)
procedure(pjt08Num(value)
  if(numberp(value) then sprintf(nil "%.8f" value) else "null")
)
procedure(pjt08XY(point)
  if(point && listp(point) && numberp(car(point)) && numberp(cadr(point)) then
    sprintf(nil "[%s,%s]" pjt08Num(car(point)) pjt08Num(cadr(point)))
  else "null")
)
procedure(pjt08Pair(points)
  if(points && listp(points) && cadr(points) then
    sprintf(nil "[%s,%s]" pjt08XY(car(points)) pjt08XY(cadr(points)))
  else "null")
)
procedure(pjt08Comma(port, count)
  when(count > 0 fprintf(port ",\n"))
)
procedure(pjt08Segment(port, seg, layer, netName, sourceKind, objIdx, segIdx)
  let((isArc mid radius cw)
    isArc = (seg->objType == "arc")
    mid = nil
    radius = nil
    cw = nil
    when(isArc
      mid = seg->xy
      radius = seg->radius
      cw = seg->isClockwise
    )
    fprintf(port "{\"type\":%s,\"layer\":%s,\"net\":%s,\"source_type\":%s,\"source_object\":%d,\"segment_index\":%d,\"endpoints\":%s,\"width\":%s,\"center\":%s,\"radius\":%s,\"clockwise\":%s}"
      pjt08Quote(seg->objType) pjt08Quote(layer) pjt08Quote(netName)
      pjt08Quote(sourceKind) objIdx segIdx pjt08Pair(seg->startEnd)
      pjt08Num(seg->width) pjt08XY(mid) pjt08Num(radius)
      if(isArc then if(cw then "true" else "false") else "null"))
  )
)
procedure(pcbExport()
  let((dsn port log layers layerNo sub sym comp compdef props prop value package refdes
      side net branch child seg netName nLayers nComps nSeg nShapes nVias nPins
      nText nShapeSeg nBoardSeg nPkgSeg i j shape void outline layerName
      nShapeVoidSeg nNoNetShapes shapeQuery shapeFound shapeName
      pin physIdx pinNo pinNet pad padQuery padLayer padBox padWidth padHeight
      padFig nPhysicalPins nPadRecords nPadErrors nPinsWithoutNumber pinName pinRotation)
    dsn = axlDBGetDesign()
    unless(dsn error("pcbExport: open a PCB design first.\n"))
    layers = axlGetParam("paramLayerGroup:ETCH")->groupMembers
    unless(layers error("pcbExport: cannot query paramLayerGroup:ETCH\n"))
    port = outfile("pcb_core_v0_8.json")
    log = outfile("pcb_core_v0_8_report.txt")
    nLayers = 0 nComps = 0 nSeg = 0 nShapes = 0 nVias = 0 nPins = 0
    nText = 0 nShapeSeg = 0 nBoardSeg = 0 nPkgSeg = 0 nShapeVoidSeg = 0
    nNoNetShapes = 0
    nPhysicalPins = 0 nPadRecords = 0 nPadErrors = 0 nPinsWithoutNumber = 0
    fprintf(port "{\n\"schema_version\":\"0.8.0-core-preview\",\n")
    fprintf(port "\"source\":{\"application\":\"Cadence Allegro\",\"units\":%s,\"stackup_order_verified\":false},\n"
      pjt08Quote(car(axlDBGetDesignUnits())))
    fprintf(port "\"layers\":[\n")
    foreach(sub layers
      pjt08Comma(port nLayers)
      nLayers = nLayers + 1
      fprintf(port "{\"id\":\"L%02d\",\"allegro_layer\":%s,\"route_index\":%d,\"film_subclasses\":[%s,%s,%s]}"
        nLayers pjt08Quote(strcat("ETCH/" sub)) nLayers
        pjt08Quote(strcat("ETCH/" sub)) pjt08Quote(strcat("PIN/" sub))
        pjt08Quote(strcat("VIA CLASS/" sub)))
    )
    fprintf(port "\n],\n\"components\":[\n")
    foreach(sym dsn->symbols
      refdes = sym->refdes
      when(refdes
        pjt08Comma(port nComps)
        nComps = nComps + 1
        comp = sym->component
        package = nil compdef = nil value = nil
        when(comp package = comp->package compdef = comp->compdef)
        props = nil
        when(compdef props = axlDBGetProperties(compdef))
        foreach(prop props when(car(prop) == 'VALUE value = cadr(prop)))
        side = if(sym->isMirrored then "bottom" else "top")
        fprintf(port "{\"refdes\":%s,\"footprint\":%s,\"value\":%s,\"side\":%s,\"position\":%s,\"rotation\":%s}"
          pjt08Quote(refdes) pjt08Quote(package) pjt08Quote(value)
          pjt08Quote(side) pjt08XY(sym->xy) pjt08Num(sym->rotation))
      )
    )
    ; Physical PIN records are distinct from per-layer pad graphics.
    ; Internal ordinal is unique within this export, even if Allegro pin->number is nil.
    fprintf(port "\n],\n\"pins\":[\n")
    foreach(sym dsn->symbols
      refdes = sym->refdes
      when(refdes
        foreach(pin sym->pins
          pjt08Comma(port nPhysicalPins)
          nPhysicalPins = nPhysicalPins + 1
          pinNo = pin->number
          unless(pinNo nPinsWithoutNumber = nPinsWithoutNumber + 1)
          pinNet = nil
          when(pin->net pinNet = pin->net->name)
          fprintf(port "{\"id\":\"PIN%06d\",\"refdes\":%s,\"number\":%s,\"padstack\":%s,\"net\":%s,\"position\":%s,\"rotation\":%s,\"through\":%s}"
            nPhysicalPins pjt08Quote(refdes) pjt08Quote(pinNo) pjt08Quote(pin->name)
            pjt08Quote(pinNet) pjt08XY(pin->xy) pjt08Num(pin->rotation)
            if(pin->isThrough then "true" else "false"))
        )
      )
    )
    fprintf(port "\n],\n\"pads\":[\n")
    physIdx = 0
    foreach(sym dsn->symbols
      refdes = sym->refdes
      when(refdes
        foreach(pin sym->pins
          physIdx = physIdx + 1
          pinNet = nil
          when(pin->net pinNet = pin->net->name)
          foreach(sub layers
            padLayer = strcat("ETCH/" sub)
            pad = nil
            padQuery = errset(axlDBGetPad(pin padLayer "REGULAR") t)
            when(padQuery pad = car(padQuery))
            if(pad && pad->bBox then
              padBox = pad->bBox
              padWidth = xCoord(cadr(padBox)) - xCoord(car(padBox))
              padHeight = yCoord(cadr(padBox)) - yCoord(car(padBox))
              padFig = pad->figureName
              pjt08Comma(port nPadRecords)
              nPadRecords = nPadRecords + 1
              fprintf(port "{\"pin_id\":\"PIN%06d\",\"refdes\":%s,\"layer\":%s,\"net\":%s,\"position\":%s,\"rotation\":%s,\"shape\":%s,\"size\":[%s,%s],\"bbox_raw\":%s,\"geometry_verified\":false}"
                physIdx pjt08Quote(refdes) pjt08Quote(padLayer) pjt08Quote(pinNet)
                pjt08XY(pin->xy) pjt08Num(pin->rotation) pjt08Quote(padFig)
                pjt08Num(padWidth) pjt08Num(padHeight) pjt08Pair(padBox))
            else
              nPadErrors = nPadErrors + 1
            )
          )
        )
      )
    )
    fprintf(port "\n],\n\"tracks\":[\n")
    i = 0
    foreach(net dsn->nets
      netName = net->name
      foreach(branch net->branches
        foreach(child branch->children
          when(child->objType == "path"
            j = 0
            foreach(seg child->segments
              pjt08Comma(port nSeg)
              nSeg = nSeg + 1 j = j + 1
              pjt08Segment(port seg child->layer netName "path" i j)
            )
          )
          i = i + 1
        )
      )
    )
    fprintf(port "\n],\n\"zones\":[\n")
    ; Every shape has net/layer and separate outer/void rings.
    ; Coverage is still net-branch associated only; standalone copper is NOT proven.
    i = 0
    foreach(net dsn->nets
      foreach(branch net->branches
        foreach(child branch->children
          when(child->objType == "shape"
            pjt08Comma(port nShapes)
            nShapes = nShapes + 1
            fprintf(port "{\"layer\":%s,\"net\":%s,\"rings\":["
              pjt08Quote(child->layer) pjt08Quote(net->name))
            j = 0
            foreach(seg child->segments
              pjt08Comma(port j) j = j + 1 nShapeSeg = nShapeSeg + 1
              pjt08Segment(port seg child->layer net->name "shape_outer" i j)
            )
            fprintf(port "],\"voids\":[")
            let((k)
              k = 0
              foreach(void child->voids
                pjt08Comma(port k) k = k + 1
                fprintf(port "[")
                j = 0
                foreach(seg void->segments
                  pjt08Comma(port j) j = j + 1 nShapeVoidSeg = nShapeVoidSeg + 1
                  pjt08Segment(port seg child->layer net->name "shape_void" i j)
                )
                fprintf(port "]")
              )
            )
            fprintf(port "]}")
          )
          i = i + 1
        )
      )
    )
    fprintf(port "\n],\n\"board\":{\"outline\":[")
    outline = dsn->designOutline
    when(outline
      j = 0
      foreach(seg outline->segments
        pjt08Comma(port nBoardSeg) nBoardSeg = nBoardSeg + 1 j = j + 1
        pjt08Segment(port seg "BOARD GEOMETRY/DESIGN_OUTLINE" nil "board_outline" 0 j)
      )
    )
    fprintf(port "]},\n\"package_graphics\":[\n")
    ; Collect assembly / silkscreen / place_bound paths and shapes; text is counted but not serialized.
    foreach(sym dsn->symbols
      refdes = sym->refdes
      when(refdes
        foreach(child sym->children
          layerName = child->layer
          when(layerName &&
            (rexMatchp("^PACKAGE GEOMETRY/ASSEMBLY_" layerName) ||
             rexMatchp("^PACKAGE GEOMETRY/SILKSCREEN_" layerName) ||
             rexMatchp("^PACKAGE GEOMETRY/PLACE_BOUND_" layerName))
            if(child->objType == "text" then
              nText = nText + 1
            else
              when(child->objType == "path" || child->objType == "shape"
                j = 0
                foreach(seg child->segments
                  pjt08Comma(port nPkgSeg) nPkgSeg = nPkgSeg + 1 j = j + 1
                  fprintf(port "{\"refdes\":%s,\"layer\":%s,\"geometry\":" pjt08Quote(refdes) pjt08Quote(layerName))
                  pjt08Segment(port seg layerName nil "package" 0 j)
                  fprintf(port "}")
                )
              )
            )
          )
        )
      )
    )
    fprintf(port "\n],\n")
    ; Diagnostics are intentionally honest: all unimplemented categories are UNKNOWN, not EMPTY.
    fprintf(port "\"extraction_status\":{\"layers\":\"collected_unverified_order\",\"tracks\":\"net_branch_only\",\"components\":\"collected\",\"zones\":\"net_branch_only_unverified\",\"board_outline\":\"designOutline_only\",\"package_graphics\":\"path_shape_only\",\"package_text\":\"not_exported\",\"refdes_text\":\"not_exported\",\"pins\":\"collected_number_unverified\",\"padstacks\":\"regular_pad_bbox_approx_unverified\",\"vias\":\"not_exported\",\"soldermask\":\"not_exported\",\"pastemask\":\"not_exported\",\"drill\":\"not_exported\",\"standalone_copper\":\"not_verified\"}\n}")
    fprintf(log "PcbToJson v0.8 core preview\n")
    fprintf(log "layers=%d\ncomponents=%d\ntracks_segments=%d\nnet_associated_shapes=%d\nshape_outer_segments=%d\nshape_void_segments=%d\nboard_outline_segments=%d\npackage_segments=%d\npackage_text_not_exported=%d\n"
      nLayers nComps nSeg nShapes nShapeSeg nShapeVoidSeg nBoardSeg nPkgSeg nText)
    fprintf(log "physical_pins=%d\npad_layer_records=%d\npin_number_missing=%d\npad_query_missing_or_error=%d\n" nPhysicalPins nPadRecords nPinsWithoutNumber nPadErrors)
    ; Read-only coverage audit. This does NOT assume that the database-wide query
    ; and net-branch traversal identify the same object universe.
    ; axlDBGetShapes is queried by each explicit ETCH subclass.
    fprintf(log "SHAPE_COVERAGE: database-wide subclass query; compare manually with net-associated count.\n")
    foreach(sub layers
      shapeName = strcat("ETCH/" sub)
      shapeQuery = errset(axlDBGetShapes(shapeName) t)
      if(shapeQuery then
        shapeFound = car(shapeQuery)
        fprintf(log "SHAPE_COVERAGE layer=%s query_count=%d\n" shapeName length(shapeFound))
      else
        fprintf(log "SHAPE_COVERAGE layer=%s query_failed=true\n" shapeName)
      )
    )
    fprintf(log "BLOCKED: net-associated shapes need count/geometry comparison to Allegro.\n")
    fprintf(log "BLOCKED: standalone copper, vias, mask/paste, drill and refdes texts NOT exported; pad geometry is BBOX PREVIEW ONLY.\n")
    close(port) close(log)
    printf("pcbExport v0.8 preview: %d layers, %d segments, %d net shapes\n" nLayers nSeg nShapes)
  )
)
axlCmdRegister("pcbExport" 'pcbExport)
